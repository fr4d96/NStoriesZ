// @vitest-environment node
//
// server-only's package code throws unconditionally outside Next's own
// bundler (which is what actually enforces the client/server boundary via
// conditional module resolution) — Vitest needs it mocked to a no-op, same
// reasoning as the existing roles.ts/staff-guard.ts split documented in
// docs/architecture.md, applied here via a mock instead of a file split
// since image-pipeline.ts's whole purpose is to be the one server-only
// module holding the admin client.
import { describe, expect, it, vi, beforeEach } from "vitest";
import sharp from "sharp";

vi.mock("server-only", () => ({}));

// In-memory fake Storage + a minimal admin client, so the real sharp
// decode/strip/resize logic in image-pipeline.ts runs against real image
// bytes without any live network call — the same "test the boundary, not
// the live call" convention used by app/(contributor)/actions.test.ts.
const objects = new Map<string, Buffer>();
const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
let mediaRow: {
  story_id: string;
  private_storage_path: string;
  processing_state: string;
} | null = null;

function key(bucket: string, path: string) {
  return `${bucket}/${path}`;
}

const fakeAdmin = {
  from: () => ({
    select: () => ({
      eq: () => ({
        single: async () => ({
          data: mediaRow,
          error: mediaRow ? null : new Error("not found"),
        }),
      }),
    }),
  }),
  // download()/upload() live on the raw-storage-http mock below now, not
  // here -- these two are the ones still called through the admin client
  // directly (by copyStoryMediaToPublic/mintMediaPreviewSignedUrl, neither
  // exercised by this file's tests, kept for shape-completeness).
  storage: {
    from: () => ({
      list: async () => ({ data: [] }),
      createSignedUrl: async () => ({
        data: { signedUrl: "https://example.com/signed" },
        error: null,
      }),
    }),
  },
  rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    return { data: null, error: null };
  }),
};

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => fakeAdmin,
}));

// image-pipeline.ts reads these directly (not just via the mocked admin
// client above) for the raw-https storage calls below.
vi.mock("@/lib/env.server", () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
  },
  getAdminEnv: () => ({ SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key" }),
}));

// downloadObject()/uploadObject() go over raw node:https (see
// lib/story/raw-storage-http.ts's doc comment for why), not
// supabase-js's storage.download()/storage.upload() -- mocked here against
// the same in-memory `objects` map as fakeAdmin.storage above so
// copyStoryMediaToPublic (which still goes through fakeAdmin.storage.list()
// for its "is it already there" check) keeps seeing consistent state.
const downloadedPaths: string[] = [];

vi.mock("@/lib/story/raw-storage-http", () => ({
  rawStorageDownload: async (
    _url: string,
    _auth: unknown,
    bucket: string,
    path: string,
  ) => {
    downloadedPaths.push(key(bucket, path));
    const buf = objects.get(key(bucket, path));
    if (!buf) throw new Error("not found");
    return buf;
  },
  rawStorageUpload: async (
    _url: string,
    _auth: unknown,
    bucket: string,
    path: string,
    bytes: Buffer,
  ) => {
    objects.set(key(bucket, path), Buffer.from(bytes));
  },
}));

const { processStoryMedia } = await import("./image-pipeline");

beforeEach(() => {
  objects.clear();
  rpcCalls.length = 0;
  mediaRow = null;
  fakeAdmin.rpc.mockClear();
  downloadedPaths.length = 0;
});

async function jpegWithExif(): Promise<Buffer> {
  return sharp({
    create: {
      width: 40,
      height: 20,
      channels: 3,
      background: { r: 200, g: 50, b: 50 },
    },
  })
    .withExif({ IFD0: { Make: "TestCamera", GPSLatitude: "0" } })
    .jpeg()
    .toBuffer();
}

describe("processStoryMedia", () => {
  it("processes a valid JPEG, strips EXIF, and records server-detected metadata", async () => {
    const source = await jpegWithExif();
    mediaRow = {
      story_id: "11111111-1111-4111-8111-111111111111",
      private_storage_path: "story/media/original.jpg",
      processing_state: "uploaded",
    };
    objects.set(
      key("story-images-private", mediaRow.private_storage_path),
      source,
    );

    await processStoryMedia("media-1");

    const recorded = rpcCalls.find(
      (c) => c.name === "record_processed_story_media",
    );
    expect(recorded).toBeDefined();
    expect(recorded!.args.p_source_mime_type).toBe("image/jpeg");
    expect(recorded!.args.p_processed_mime_type).toBe("image/jpeg");
    expect(recorded!.args.p_source_width).toBe(40);
    expect(recorded!.args.p_source_height).toBe(20);
    expect(typeof recorded!.args.p_sha256).toBe("string");
    expect(recorded!.args.p_sha256 as string).toMatch(/^[0-9a-f]{64}$/);

    // Prove stripping actually happened via the real pipeline output, not
    // just sharp's documented default — decode what was actually staged.
    const stagedPath = recorded!.args
      .p_processed_private_storage_path as string;
    const staged = objects.get(key("story-images-private", stagedPath));
    expect(staged).toBeDefined();
    const strippedMetadata = await sharp(staged!).metadata();
    expect(strippedMetadata.exif).toBeUndefined();

    // Content-addressed path convention.
    expect(stagedPath).toBe(
      `${mediaRow.story_id}/media-1/processed-${recorded!.args.p_sha256}.jpg`,
    );
  });

  // The upload route (app/(contributor)/stories/[id]/edit/upload/route.ts)
  // calls processStoryMedia synchronously, right after uploading these
  // exact bytes -- passing them through here skips a real, measured
  // redundant download of the *original* (see processStoryMedia's own doc
  // comment). verifyUploadedBytes() still legitimately downloads the
  // *processed* derivative afterward to confirm it landed correctly -- an
  // unrelated, intentional download this fast path does not touch -- so
  // the assertion below checks the original's specific path was never
  // downloaded, not that zero downloads happened at all.
  it("skips the redundant download when the original bytes are already known", async () => {
    const source = await jpegWithExif();
    mediaRow = {
      story_id: "11111111-1111-4111-8111-111111111111",
      private_storage_path: "story/media/original.jpg",
      processing_state: "uploaded",
    };
    // Deliberately NOT put in `objects` -- if the fast path were broken and
    // this fell through to a real download, it would throw "not found"
    // rather than silently succeeding, so this also proves the passed-in
    // bytes (not a coincidentally-present object) are what got processed.

    await processStoryMedia("media-3", source);

    expect(downloadedPaths).not.toContain(
      key("story-images-private", mediaRow.private_storage_path),
    );
    const recorded = rpcCalls.find(
      (c) => c.name === "record_processed_story_media",
    );
    expect(recorded).toBeDefined();
    expect(recorded!.args.p_source_mime_type).toBe("image/jpeg");
    expect(recorded!.args.p_source_width).toBe(40);
    expect(recorded!.args.p_source_height).toBe(20);
  });

  it("records a processing failure for a non-image file", async () => {
    mediaRow = {
      story_id: "11111111-1111-4111-8111-111111111111",
      private_storage_path: "story/media/original.jpg",
      processing_state: "uploaded",
    };
    objects.set(
      key("story-images-private", mediaRow.private_storage_path),
      Buffer.from("not an image at all"),
    );

    await processStoryMedia("media-2");

    const failed = rpcCalls.find(
      (c) => c.name === "record_story_media_processing_failed",
    );
    expect(failed).toBeDefined();
    expect(failed!.args.p_error_code).toBe("unrecognized_image_format");
    expect(
      rpcCalls.some((c) => c.name === "record_processed_story_media"),
    ).toBe(false);
  });

  // A real animated-WebP fixture (rather than one synthesized at runtime —
  // sharp has no straightforward API for authoring a genuinely multi-page
  // WebP from scratch, and the couple of approaches tried while writing
  // this test either silently collapsed to a single frame or failed
  // outright) is deferred to Sub-phase 5's expanded test suite, using a
  // small checked-in fixture file. What this test suite DID catch while
  // attempting it: image-pipeline.ts's metadata probe needed `pages: -1`
  // to ever populate `metadata.pages` at all — without it, an animated
  // source would have silently passed the check undetected. Fixed above;
  // a real-fixture regression test for the full rejection path is tracked
  // for Sub-phase 5, not skipped silently.
});
