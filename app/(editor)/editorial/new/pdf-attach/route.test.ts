// @vitest-environment node
//
// server-only's package code throws unconditionally outside Next's own
// bundler -- same reasoning/mock as lib/story/pdf-page-attachment.test.ts,
// whose in-memory fake of the media-upload RPCs this file extends with the
// two extra RPCs Phase B needs (create_editorial_import_draft,
// save_revision_draft) plus a `user_roles`/`contributors` table fake for
// the auth check and "new contributor" path. Exercises the real Route
// Handler end to end (constructs an actual multipart NextRequest and calls
// the exported POST()) -- this is about the wiring Stage 4 adds, not
// re-proving Stage 1-3's already-tested internals (rendering, the image
// pipeline, content_json assembly), which is why the fake RPCs below are
// deliberately minimal rather than a full second copy of
// pdf-page-attachment.test.ts's capacity/rollback scenarios.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";
import { extractMediaIds } from "@/lib/story/markdown-media";

vi.mock("server-only", () => ({}));

const MAX_IMAGES_PER_REVISION = 12;
const CONTRIBUTOR_ID = "33333333-3333-4333-8333-333333333333";

type FakeMediaRow = {
  id: string;
  storyId: string;
  reservedForRevisionId: string;
  processingState: "pending_upload" | "uploaded" | "processed" | "failed";
  sha256: string | null;
};
type FakeRevisionMediaRow = {
  revisionId: string;
  mediaId: string;
  sortOrder: number;
  decorative: boolean;
  altText: string | null;
};
type FakeStory = {
  id: string;
  revisionId: string;
  contributorId: string;
  title: string;
  contentJson: unknown;
  version: number;
};

let mediaRows: Map<string, FakeMediaRow>;
let revisionMediaRows: FakeRevisionMediaRow[];
let stories: Map<string, FakeStory>;
let revisionToStory: Map<string, string>;
let contributors: Set<string>;
let mediaIdCounter: number;
let storyIdCounter: number;
let currentUser: { id: string } | null;
let currentRole: "user" | "editor" | "moderator" | "admin" | null;
const objects = new Map<string, Buffer>();

function resetFakeDb() {
  mediaRows = new Map();
  revisionMediaRows = [];
  stories = new Map();
  revisionToStory = new Map();
  contributors = new Set([CONTRIBUTOR_ID]);
  mediaIdCounter = 0;
  storyIdCounter = 0;
  currentUser = { id: "editor-1" };
  currentRole = "editor";
  objects.clear();
}
resetFakeDb();

const fakeSupabase = {
  auth: {
    getSession: async () => {
      if (!currentUser) return { data: { session: null } };
      return { data: { session: { access_token: "test-access-token" } } };
    },
  },
  from: (table: string) => {
    if (table === "user_roles") {
      return {
        select: () => ({
          eq: () => ({
            single: async () =>
              currentRole
                ? { data: { role: currentRole }, error: null }
                : { data: null, error: new Error("not found") },
          }),
        }),
      };
    }
    if (table === "contributors") {
      return {
        insert: (row: { display_name: string }) => ({
          select: () => ({
            single: async () => {
              const id = `new-contributor-${row.display_name}`;
              contributors.add(id);
              return { data: { id }, error: null };
            },
          }),
        }),
      };
    }
    throw new Error(`Unmocked table: ${table}`);
  },
  rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
    switch (name) {
      case "create_editorial_import_draft": {
        const contributorId = args.p_contributor_id as string;
        if (!contributors.has(contributorId)) {
          return { data: null, error: new Error("No such contributor") };
        }
        storyIdCounter += 1;
        mediaIdCounter += 1;
        const storyId = `story-${storyIdCounter}`;
        const revisionId = `revision-${storyIdCounter}`;
        stories.set(storyId, {
          id: storyId,
          revisionId,
          contributorId,
          title: args.p_title as string,
          contentJson: args.p_content_json ?? [],
          version: 1,
        });
        revisionToStory.set(revisionId, storyId);
        return {
          data: [{ story_id: storyId, revision_id: revisionId }],
          error: null,
        };
      }
      case "begin_story_media_upload": {
        const revisionId = args.p_revision_id as string;
        const attachedCount = revisionMediaRows.filter(
          (r) => r.revisionId === revisionId,
        ).length;
        if (attachedCount >= MAX_IMAGES_PER_REVISION) {
          return { data: null, error: new Error("capacity exceeded") };
        }
        mediaIdCounter += 1;
        // A real UUID shape -- extractMediaIds()'s embed-token regex
        // (lib/story/markdown-media.ts) only matches UUID-formatted ids, so
        // a non-UUID fake id would silently fail to round-trip through
        // content_json in this test even though the real pipeline always
        // produces real UUIDs.
        const id = `00000000-0000-4000-8000-${String(mediaIdCounter).padStart(12, "0")}`;
        const storyId = revisionToStory.get(revisionId)!;
        mediaRows.set(id, {
          id,
          storyId,
          reservedForRevisionId: revisionId,
          processingState: "pending_upload",
          sha256: null,
        });
        return {
          data: [
            { media_id: id, reserved_path: `${storyId}/${id}/original.png` },
          ],
          error: null,
        };
      }
      case "finalize_story_media_upload": {
        const mediaId = args.p_media_id as string;
        const media = mediaRows.get(mediaId);
        if (!media) return { data: null, error: new Error("no such media") };
        const storyId = media.storyId;
        const story = stories.get(storyId)!;
        const expectedVersion = args.p_expected_version as number;
        if (expectedVersion !== story.version) {
          return { data: null, error: new Error("stale version") };
        }
        const nextSort =
          Math.max(
            -1,
            ...revisionMediaRows
              .filter((r) => r.revisionId === media.reservedForRevisionId)
              .map((r) => r.sortOrder),
          ) + 1;
        revisionMediaRows.push({
          revisionId: media.reservedForRevisionId,
          mediaId,
          sortOrder: nextSort,
          decorative: true,
          altText: null,
        });
        media.processingState = "uploaded";
        story.version += 1;
        return { data: null, error: null };
      }
      case "cancel_pending_story_media_upload": {
        const mediaId = args.p_media_id as string;
        mediaRows.delete(mediaId);
        return { data: null, error: null };
      }
      case "detach_story_media": {
        const revisionId = args.p_revision_id as string;
        const mediaId = args.p_media_id as string;
        revisionMediaRows = revisionMediaRows.filter(
          (r) => !(r.revisionId === revisionId && r.mediaId === mediaId),
        );
        const storyId = revisionToStory.get(revisionId);
        if (storyId) stories.get(storyId)!.version += 1;
        return { data: null, error: null };
      }
      case "get_story_preview": {
        const storyId = args.p_story_id as string;
        const story = stories.get(storyId);
        if (!story) return { data: [], error: null };
        const rows = revisionMediaRows
          .filter((r) => r.revisionId === story.revisionId)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((r) => {
            const media = mediaRows.get(r.mediaId)!;
            return {
              mediaId: r.mediaId,
              sortOrder: r.sortOrder,
              isCover: false,
              altText: r.altText,
              caption: null,
              decorative: r.decorative,
              processingState: media.processingState,
              sha256: media.sha256,
            };
          });
        return {
          data: [
            {
              story_id: story.id,
              title: story.title,
              excerpt: null,
              content_json: story.contentJson,
              trip_start_date: null,
              trip_end_date: null,
              trip_year: null,
              travel_style: null,
              total_expense_nzd_cents: null,
              source_kind: "editorial_import",
              lifecycle_status: "draft",
              revision_id: story.revisionId,
              revision_status: "draft",
              version: story.version,
              attribution_type: "display_name",
              attribution_value: "Test Contributor",
              viewer_relationship: "assigned_editor",
              media: rows,
            },
          ],
          error: null,
        };
      }
      case "record_processed_story_media": {
        const mediaId = args.p_media_id as string;
        const media = mediaRows.get(mediaId);
        if (media) {
          media.processingState = "processed";
          media.sha256 = args.p_sha256 as string;
        }
        return { data: null, error: null };
      }
      case "record_story_media_processing_failed": {
        const mediaId = args.p_media_id as string;
        const media = mediaRows.get(mediaId);
        if (media) media.processingState = "failed";
        return { data: null, error: null };
      }
      case "update_story_media_caption": {
        const revisionId = args.p_revision_id as string;
        const mediaId = args.p_media_id as string;
        const storyId = revisionToStory.get(revisionId);
        if (!storyId)
          return { data: null, error: new Error("no such revision") };
        const story = stories.get(storyId)!;
        const expectedVersion = args.p_expected_version as number;
        if (expectedVersion !== story.version) {
          return { data: null, error: new Error("stale version") };
        }
        const row = revisionMediaRows.find(
          (r) => r.revisionId === revisionId && r.mediaId === mediaId,
        );
        if (!row) return { data: null, error: new Error("no such media") };
        row.altText = args.p_alt_text as string | null;
        row.decorative = Boolean(args.p_decorative);
        story.version += 1;
        return { data: null, error: null };
      }
      case "save_revision_draft": {
        const revisionId = args.p_revision_id as string;
        const storyId = revisionToStory.get(revisionId);
        if (!storyId)
          return { data: null, error: new Error("no such revision") };
        const story = stories.get(storyId)!;
        const expectedVersion = args.p_expected_version as number;
        if (expectedVersion !== story.version) {
          return { data: null, error: new Error("stale version") };
        }
        story.title = args.p_title as string;
        story.contentJson = args.p_content_json;
        story.version += 1;
        return { data: story.version, error: null };
      }
      default:
        throw new Error(`Unmocked RPC in test fake: ${name}`);
    }
  }),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fakeSupabase,
}));

vi.mock("@/lib/auth/get-current-user", () => ({
  getCurrentUser: async () => currentUser,
}));

const fakeAdmin = {
  from: () => ({
    select: () => ({
      eq: (_col: string, id: string) => ({
        single: async () => {
          const media = mediaRows.get(id);
          if (!media) return { data: null, error: new Error("not found") };
          return {
            data: {
              story_id: media.storyId,
              private_storage_path: `${media.storyId}/${media.id}/original.png`,
              processing_state: media.processingState,
            },
            error: null,
          };
        },
      }),
    }),
  }),
  storage: {
    from: () => ({
      list: async () => ({ data: [] }),
      createSignedUrl: async () => ({
        data: { signedUrl: "https://example.com/signed" },
        error: null,
      }),
    }),
  },
  rpc: (name: string, args: Record<string, unknown>) =>
    fakeSupabase.rpc(name, args),
};

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => fakeAdmin,
}));

vi.mock("@/lib/env.server", () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
  },
  getAdminEnv: () => ({ SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key" }),
}));

vi.mock("@/lib/story/raw-storage-http", () => ({
  rawStorageDownload: async (
    _url: string,
    _auth: unknown,
    bucket: string,
    p: string,
  ) => {
    const buf = objects.get(`${bucket}/${p}`);
    if (!buf) throw new Error("not found");
    return buf;
  },
  rawStorageUpload: async (
    _url: string,
    _auth: unknown,
    bucket: string,
    p: string,
    bytes: Buffer,
  ) => {
    objects.set(`${bucket}/${p}`, Buffer.from(bytes));
  },
}));

const FIXTURES_DIR = path.join(process.cwd(), "lib", "story", "__fixtures__");
async function fixture(name: string): Promise<Buffer> {
  return readFile(path.join(FIXTURES_DIR, name));
}

function requestWithFields(
  bytes: Buffer,
  fields: Record<string, string>,
  filename = "My Trip.pdf",
): NextRequest {
  const formData = new FormData();
  formData.append(
    "file",
    new File([new Uint8Array(bytes)], filename, { type: "application/pdf" }),
  );
  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, value);
  }
  return new NextRequest("http://localhost/editorial/new/pdf-attach", {
    method: "POST",
    body: formData,
  });
}

function existingContributorFields(pageNumbers: number[], title = "My Trip") {
  return {
    title,
    pageNumbers: JSON.stringify(pageNumbers),
    contributorMode: "existing",
    existingContributorId: CONTRIBUTOR_ID,
  };
}

beforeEach(() => {
  resetFakeDb();
  fakeSupabase.rpc.mockClear();
});

describe("POST /editorial/new/pdf-attach", () => {
  it("rejects a non-editorial-role caller before creating anything", async () => {
    currentRole = "user";
    const { POST } = await import("./route");
    const bytes = await fixture("valid-two-page.pdf");
    const response = await POST(
      requestWithFields(bytes, existingContributorFields([1, 2])),
    );

    expect(response.status).toBe(403);
    expect(stories.size).toBe(0);
  });

  it("rejects a signed-out caller", async () => {
    currentUser = null;
    currentRole = null;
    const { POST } = await import("./route");
    const bytes = await fixture("valid-two-page.pdf");
    const response = await POST(
      requestWithFields(bytes, existingContributorFields([1, 2])),
    );

    expect(response.status).toBe(403);
  });

  it("creates a draft with the selected pages attached, in order, and content_json referencing them", async () => {
    const { POST } = await import("./route");
    const bytes = await fixture("valid-two-page.pdf");
    const response = await POST(
      requestWithFields(bytes, existingContributorFields([2, 1])),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.attachedCount).toBe(2);
    expect(body.duplicatePages).toEqual([]);
    expect(body.storyId).toBeTruthy();
    expect(body.revisionId).toBeTruthy();

    const story = stories.get(body.storyId)!;
    expect(story.title).toBe("My Trip");
    expect(revisionMediaRows).toHaveLength(2);
    // Selection order [2, 1] is attach order -- sort_order 0 is page 2.
    const orderedMediaIds = revisionMediaRows
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((r) => r.mediaId);
    const embeddedIds = extractMediaIds(
      (story.contentJson as { text: string }[]).map((b) => b.text).join("\n"),
    );
    expect(embeddedIds).toEqual(orderedMediaIds);
    for (const mediaId of orderedMediaIds) {
      expect(mediaRows.get(mediaId)?.processingState).toBe("processed");
    }
  });

  it("applies Stage 5's per-page alt text to the matching story_revision_media rows via update_story_media_caption", async () => {
    const { POST } = await import("./route");
    const bytes = await fixture("valid-two-page.pdf");
    const response = await POST(
      requestWithFields(bytes, {
        ...existingContributorFields([2, 1]),
        altText: JSON.stringify({
          "2": "Passport stamp page",
          "1": "Cover page",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(revisionMediaRows).toHaveLength(2);
    // Selection order [2, 1] -- sort_order 0 is page 2.
    const bySortOrder = [...revisionMediaRows].sort(
      (a, b) => a.sortOrder - b.sortOrder,
    );
    expect(bySortOrder[0].altText).toBe("Passport stamp page");
    expect(bySortOrder[0].decorative).toBe(false);
    expect(bySortOrder[1].altText).toBe("Cover page");
    expect(bySortOrder[1].decorative).toBe(false);
  });

  it("leaves a page decorative/without alt text when the map omits it, and doesn't fail the request on malformed altText JSON", async () => {
    const { POST } = await import("./route");
    const bytes = await fixture("valid-two-page.pdf");
    const response = await POST(
      requestWithFields(bytes, {
        ...existingContributorFields([1]),
        altText: "not valid json",
      }),
    );

    expect(response.status).toBe(200);
    expect(revisionMediaRows).toHaveLength(1);
    expect(revisionMediaRows[0].altText).toBeNull();
    expect(revisionMediaRows[0].decorative).toBe(true);
  });

  it("creates a new unlinked contributor when contributorMode=new", async () => {
    const { POST } = await import("./route");
    const bytes = await fixture("valid-two-page.pdf");
    const response = await POST(
      requestWithFields(bytes, {
        title: "New Contributor Trip",
        pageNumbers: JSON.stringify([1]),
        contributorMode: "new",
        newContributorDisplayName: "Test Contributor",
        newContributorAttributionType: "display_name",
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    const story = stories.get(body.storyId)!;
    expect(story.contributorId).toBe("new-contributor-Test Contributor");
  });

  it("rejects a page selection referencing a page number the PDF doesn't have, without creating a draft that keeps it", async () => {
    const { POST } = await import("./route");
    const bytes = await fixture("valid-two-page.pdf");
    const response = await POST(
      requestWithFields(bytes, existingContributorFields([1, 99])),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBeTruthy();
    // No page ever got attached to the draft this call created.
    expect(revisionMediaRows).toHaveLength(0);
  });

  it("rejects a selection larger than the 12-page cap", async () => {
    const { POST } = await import("./route");
    const bytes = await fixture("valid-two-page.pdf");
    const response = await POST(
      requestWithFields(
        bytes,
        existingContributorFields(Array.from({ length: 13 }, () => 1)),
      ),
    );

    expect(response.status).toBe(400);
  });

  it("re-validates the re-uploaded PDF's page count server-side -- a client claiming a page exists that the actual re-parsed PDF doesn't have is rejected even though nothing here trusts a client-declared page count", async () => {
    const { POST } = await import("./route");
    // The real fixture only has 2 pages; page 5 does not exist no matter
    // what the client claims Phase A returned.
    const bytes = await fixture("valid-two-page.pdf");
    const response = await POST(
      requestWithFields(bytes, existingContributorFields([5])),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/page/i);
  });

  it("rejects a non-PDF file even if the page selection and contributor fields are all otherwise valid", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      requestWithFields(
        Buffer.from("not a pdf"),
        existingContributorFields([1]),
        "fake.pdf",
      ),
    );

    expect(response.status).toBe(400);
    expect(stories.size).toBe(0);
  });
});
