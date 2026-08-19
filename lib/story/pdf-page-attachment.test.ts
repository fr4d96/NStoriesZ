// @vitest-environment node
//
// server-only's package code throws unconditionally outside Next's own
// bundler -- same reasoning/mock as lib/story/image-pipeline.test.ts and
// lib/story/pdf-import.test.ts.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

vi.mock("server-only", () => ({}));

// --- In-memory fake of the exact tables/RPCs this call chain touches -----
//
// This mirrors lib/story/image-pipeline.test.ts's "test the boundary, not
// the live call" convention (an in-memory fake Storage + a minimal admin
// client), extended to also fake the REGULAR (RLS-respecting) client's RPCs
// that lib/story/mutations.ts and lib/story/contributor-queries.ts call
// (begin_/finalize_/cancel_story_media_upload, detach_story_media,
// get_story_preview) -- close enough to the real SQL semantics (see the
// migrations this fake is modeled on:
// supabase/migrations/20260804090100_story_media_upload_functions.sql,
// .../20260806110100_fix_finalize_upload_alt_text_constraint.sql,
// .../20260815100000_detach_media_strips_embed_tokens.sql,
// .../20260806090100_add_sha256_to_story_preview_media.sql) to exercise the
// real capacity/ordering/duplicate-detection logic in
// lib/story/pdf-page-attachment.ts without Docker/a live Supabase project.

const MAX_IMAGES_PER_REVISION = 12;

type FakeMediaRow = {
  id: string;
  storyId: string;
  reservedForRevisionId: string;
  privateStoragePath: string;
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

let mediaRows: Map<string, FakeMediaRow>;
let revisionMediaRows: FakeRevisionMediaRow[];
let storyVersion: number;
let mediaIdCounter: number;
let currentUser: { id: string } | null;
const objects = new Map<string, Buffer>();

const STORY_ID = "11111111-1111-4111-8111-111111111111";
const REVISION_ID = "22222222-2222-4222-8222-222222222222";

function storageKey(bucket: string, path: string) {
  return `${bucket}/${path}`;
}

function resetFakeDb() {
  mediaRows = new Map();
  revisionMediaRows = [];
  storyVersion = 1;
  mediaIdCounter = 0;
  currentUser = { id: "editor-1" };
  objects.clear();
}
resetFakeDb();

/** Test-only escape hatch to seed pre-existing attached media, e.g. for
 * capacity-limit tests, without going through the real attach flow. */
function seedExistingAttachedMedia(count: number) {
  for (let i = 0; i < count; i++) {
    const id = `seed-media-${i}`;
    mediaRows.set(id, {
      id,
      storyId: STORY_ID,
      reservedForRevisionId: REVISION_ID,
      privateStoragePath: `${STORY_ID}/${id}/original.png`,
      processingState: "processed",
      sha256: `seed-hash-${i}`,
    });
    revisionMediaRows.push({
      revisionId: REVISION_ID,
      mediaId: id,
      sortOrder: i,
      decorative: true,
      altText: null,
    });
  }
}

/** Forces the Nth call to finalize_story_media_upload to fail, to exercise
 * the rollback path for a failure that happens after some pages already
 * succeeded (e.g. a capacity race that begin_story_media_upload's own
 * transactional check catches after this module's own up-front check already
 * passed). 1-indexed. */
let forceFinalizeFailureOnCall: number | null = null;
let finalizeCallCount = 0;

const fakeSupabase = {
  auth: {
    getSession: async () => {
      if (!currentUser) return { data: { session: null } };
      return { data: { session: { access_token: "test-access-token" } } };
    },
  },
  rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
    switch (name) {
      case "begin_story_media_upload": {
        const revisionId = args.p_revision_id as string;
        const attachedCount = revisionMediaRows.filter(
          (r) => r.revisionId === revisionId,
        ).length;
        const pendingCount = [...mediaRows.values()].filter(
          (m) =>
            m.reservedForRevisionId === revisionId &&
            m.processingState === "pending_upload",
        ).length;
        if (attachedCount + pendingCount >= MAX_IMAGES_PER_REVISION) {
          return {
            data: null,
            error: new Error(
              `Revision ${revisionId} already has ${attachedCount + pendingCount} images attached or reserved (max ${MAX_IMAGES_PER_REVISION})`,
            ),
          };
        }
        mediaIdCounter += 1;
        const id = `media-${mediaIdCounter}`;
        const reservedPath = `${STORY_ID}/${id}/original.png`;
        mediaRows.set(id, {
          id,
          storyId: STORY_ID,
          reservedForRevisionId: revisionId,
          privateStoragePath: reservedPath,
          processingState: "pending_upload",
          sha256: null,
        });
        return {
          data: [{ media_id: id, reserved_path: reservedPath }],
          error: null,
        };
      }
      case "finalize_story_media_upload": {
        finalizeCallCount += 1;
        if (forceFinalizeFailureOnCall === finalizeCallCount) {
          return { data: null, error: new Error("forced test failure") };
        }
        const mediaId = args.p_media_id as string;
        const media = mediaRows.get(mediaId);
        if (!media) return { data: null, error: new Error("no such media") };
        if (media.processingState !== "pending_upload") {
          return { data: null, error: null }; // idempotent no-op, per real RPC
        }
        const expectedVersion = args.p_expected_version as number;
        if (expectedVersion !== storyVersion) {
          return {
            data: null,
            error: new Error(
              `Stale version (expected ${storyVersion}, got ${expectedVersion})`,
            ),
          };
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
        storyVersion += 1;
        return { data: null, error: null };
      }
      case "cancel_pending_story_media_upload": {
        const mediaId = args.p_media_id as string;
        const media = mediaRows.get(mediaId);
        if (!media || media.processingState !== "pending_upload") {
          return { data: null, error: new Error("not a pending upload") };
        }
        mediaRows.delete(mediaId);
        return { data: null, error: null };
      }
      case "detach_story_media": {
        const revisionId = args.p_revision_id as string;
        const mediaId = args.p_media_id as string;
        const expectedVersion = args.p_expected_version as number;
        if (expectedVersion !== storyVersion) {
          return { data: null, error: new Error("stale version") };
        }
        revisionMediaRows = revisionMediaRows.filter(
          (r) => !(r.revisionId === revisionId && r.mediaId === mediaId),
        );
        storyVersion += 1;
        return { data: null, error: null };
      }
      case "get_story_preview": {
        if (!currentUser) return { data: null, error: new Error("no user") };
        const rows = revisionMediaRows
          .filter((r) => r.revisionId === REVISION_ID)
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
              story_id: STORY_ID,
              title: "Test story",
              excerpt: null,
              content_json: null,
              trip_start_date: null,
              trip_end_date: null,
              trip_year: null,
              travel_style: null,
              total_expense_nzd_cents: null,
              source_kind: "editorial_import",
              lifecycle_status: "draft",
              revision_id: REVISION_ID,
              revision_status: "draft",
              version: storyVersion,
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

// image-pipeline.ts's admin-client surface: only the one `.from(...).select()
// .eq().single()` read it needs to look up a media row by id, keyed off the
// SAME in-memory `mediaRows` map the regular-client fake above writes to, so
// a media row created via begin_story_media_upload is visible to
// processStoryMedia exactly as it would be through a real database.
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
              private_storage_path: media.privateStoragePath,
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

// Shared by both the direct upload this module does (via the regular
// client's session token) and image-pipeline.ts's own download/upload (via
// the admin client) -- both go through this one mock, against the same
// in-memory `objects` map, so bytes uploaded here are exactly what
// processStoryMedia downloads and processes.
vi.mock("@/lib/story/raw-storage-http", () => ({
  rawStorageDownload: async (
    _url: string,
    _auth: unknown,
    bucket: string,
    p: string,
  ) => {
    const buf = objects.get(storageKey(bucket, p));
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
    objects.set(storageKey(bucket, p), Buffer.from(bytes));
  },
}));

const { attachPdfPagesToRevision } = await import("./pdf-page-attachment");

const FIXTURES_DIR = path.join(__dirname, "__fixtures__");
async function fixture(name: string): Promise<Buffer> {
  return readFile(path.join(FIXTURES_DIR, name));
}

beforeEach(() => {
  resetFakeDb();
  forceFinalizeFailureOnCall = null;
  finalizeCallCount = 0;
  fakeSupabase.rpc.mockClear();
});

describe("attachPdfPagesToRevision", () => {
  it("renders selected pages and attaches them through the real image pipeline, in selection order", async () => {
    const bytes = await fixture("valid-two-page.pdf");
    const result = await attachPdfPagesToRevision({
      bytes,
      pageNumbers: [2, 1],
      storyId: STORY_ID,
      revisionId: REVISION_ID,
      expectedVersion: 1,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attached).toHaveLength(2);
    expect(result.attached.map((a) => a.pageNumber)).toEqual([2, 1]);
    // sort_order reflects attach order (selection order), not page number.
    expect(result.attached.map((a) => a.sortOrder)).toEqual([0, 1]);
    for (const a of result.attached) {
      expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(a.isDuplicate).toBe(false);
    }

    // Landed in the private bucket and went through real processing.
    expect(revisionMediaRows).toHaveLength(2);
    for (const row of revisionMediaRows) {
      const media = mediaRows.get(row.mediaId)!;
      expect(media.processingState).toBe("processed");
      // decorative=true, alt_text left null -- Stage 4's review step fills
      // it in, per story_revision_media_alt_text_required's constraint.
      expect(row.decorative).toBe(true);
      expect(row.altText).toBeNull();
    }
  });

  it("rejects a selection larger than the 12-image-per-revision cap, cleanly, before rendering or attaching anything", async () => {
    const bytes = await fixture("valid-two-page.pdf");
    const pageNumbers = Array.from({ length: 13 }, () => 1);
    const result = await attachPdfPagesToRevision({
      bytes,
      pageNumbers,
      storyId: STORY_ID,
      revisionId: REVISION_ID,
      expectedVersion: 1,
    });

    expect(result).toEqual({ ok: false, error: "too_many_pages_selected" });
    expect(revisionMediaRows).toHaveLength(0);
    expect(mediaRows.size).toBe(0);
  });

  it("rejects a selection that would push this revision's total over the cap, without partially attaching it", async () => {
    seedExistingAttachedMedia(11);
    const bytes = await fixture("valid-two-page.pdf");
    const result = await attachPdfPagesToRevision({
      bytes,
      pageNumbers: [1, 2],
      storyId: STORY_ID,
      revisionId: REVISION_ID,
      expectedVersion: 1,
    });

    expect(result).toEqual({ ok: false, error: "capacity_exceeded" });
    // Still exactly the 11 seeded rows -- nothing new was attached.
    expect(revisionMediaRows).toHaveLength(11);
  });

  it("rolls back everything it created when a later page fails mid-batch (not partially applied)", async () => {
    // Room for exactly 1 more image -- the up-front check passes for a
    // 2-page selection only if capacity looks free at check time; force the
    // SECOND finalize call to fail (simulating a race/late failure) and
    // confirm the first page's attachment is rolled back too.
    seedExistingAttachedMedia(10);
    forceFinalizeFailureOnCall = 2;

    const bytes = await fixture("valid-two-page.pdf");
    const result = await attachPdfPagesToRevision({
      bytes,
      pageNumbers: [1, 2],
      storyId: STORY_ID,
      revisionId: REVISION_ID,
      expectedVersion: 1,
    });

    expect(result).toEqual({ ok: false, error: "attach_failed" });
    // Back to exactly the 10 seeded rows -- page 1's successful attach was
    // rolled back (detached) once page 2 failed.
    expect(revisionMediaRows).toHaveLength(10);
    expect(revisionMediaRows.every((r) => r.mediaId.startsWith("seed-"))).toBe(
      true,
    );
  });

  it("flags a duplicate-page selection via the same sha256 signal, without rejecting the attach", async () => {
    const bytes = await fixture("valid-two-page.pdf");
    const result = await attachPdfPagesToRevision({
      bytes,
      pageNumbers: [1, 1],
      storyId: STORY_ID,
      revisionId: REVISION_ID,
      expectedVersion: 1,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attached).toHaveLength(2);
    expect(result.attached[0].sha256).toBe(result.attached[1].sha256);
    expect(result.attached[0].isDuplicate).toBe(true);
    expect(result.attached[1].isDuplicate).toBe(true);
  });

  it("propagates a render-time rejection (e.g. an out-of-range page number) without attaching anything", async () => {
    const bytes = await fixture("valid-two-page.pdf");
    const result = await attachPdfPagesToRevision({
      bytes,
      pageNumbers: [1, 99],
      storyId: STORY_ID,
      revisionId: REVISION_ID,
      expectedVersion: 1,
    });

    expect(result).toEqual({ ok: false, error: "invalid_page_numbers" });
    expect(revisionMediaRows).toHaveLength(0);
  });

  it("rejects when there is no authenticated user", async () => {
    currentUser = null;
    const bytes = await fixture("valid-two-page.pdf");
    const result = await attachPdfPagesToRevision({
      bytes,
      pageNumbers: [1],
      storyId: STORY_ID,
      revisionId: REVISION_ID,
      expectedVersion: 1,
    });

    expect(result).toEqual({ ok: false, error: "unauthorized" });
  });
});
