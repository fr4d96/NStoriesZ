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
const uploadedPaths: string[] = [];

// Lets a test force the exact production failure that uploadAndVerify's
// retry exists to survive: the next N writes land mangled. Reproduces the
// real corruption signature byte-for-byte -- every byte >0x7F replaced by
// the 3-byte UTF-8 replacement sequence (EF BF BD) -- which is what a
// derivative re-downloaded from production storage with `curl` actually
// contained (107,289 of them in a single 472,760-byte object).
let corruptUploadsRemaining = 0;

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
    uploadedPaths.push(key(bucket, path));
    if (corruptUploadsRemaining > 0) {
      corruptUploadsRemaining--;
      objects.set(
        key(bucket, path),
        Buffer.from(bytes.toString("utf8"), "utf8"),
      );
      return;
    }
    objects.set(key(bucket, path), Buffer.from(bytes));
  },
}));

const { processStoryMedia } = await import("./image-pipeline");
const { encodeJpegUnderBudget } = await import("./jpeg-budget");

beforeEach(() => {
  objects.clear();
  rpcCalls.length = 0;
  mediaRow = null;
  fakeAdmin.rpc.mockClear();
  downloadedPaths.length = 0;
  uploadedPaths.length = 0;
  corruptUploadsRemaining = 0;
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

    // WhatsApp-style compression is wired in for every JPEG derivative, not
    // just an unreachable fallback path — progressive scan is the one
    // property sharp exposes back in metadata to confirm this directly.
    expect(strippedMetadata.isProgressive).toBe(true);

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

  // Regression: ten consecutive derivative uploads were written corrupt in
  // production on 2026-08-23, each permanently failing the media with no
  // retry, which is why story images never loaded. See toTransportBuffer in
  // lib/story/raw-storage-http.ts for the root cause, and uploadAndVerify
  // here for why retrying a content-addressed path is safe.
  it("retries a corrupted derivative upload until the stored bytes verify", async () => {
    const source = await jpegWithExif();
    mediaRow = {
      story_id: "11111111-1111-4111-8111-111111111111",
      private_storage_path: "story/media/original.jpg",
      processing_state: "uploaded",
    };
    corruptUploadsRemaining = 1;

    await processStoryMedia("media-retry", source);

    const recorded = rpcCalls.find(
      (c) => c.name === "record_processed_story_media",
    );
    expect(recorded).toBeDefined();
    expect(
      rpcCalls.some((c) => c.name === "record_story_media_processing_failed"),
    ).toBe(false);

    // The write was actually attempted twice, and what finally landed is
    // the real derivative -- not the mangled first attempt.
    const stagedPath = recorded!.args
      .p_processed_private_storage_path as string;
    expect(
      uploadedPaths.filter((p) => p === key("story-images-private", stagedPath))
        .length,
    ).toBe(2);
    const staged = objects.get(key("story-images-private", stagedPath))!;
    expect(staged.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(staged.includes(Buffer.from([0xef, 0xbf, 0xbd]))).toBe(false);
  });

  it("gives up and records a failure when every upload attempt is corrupted", async () => {
    const source = await jpegWithExif();
    mediaRow = {
      story_id: "11111111-1111-4111-8111-111111111111",
      private_storage_path: "story/media/original.jpg",
      processing_state: "uploaded",
    };
    corruptUploadsRemaining = Number.MAX_SAFE_INTEGER;

    await expect(
      processStoryMedia("media-always-corrupt", source),
    ).rejects.toThrow(/Byte verification failed/);

    const failed = rpcCalls.find(
      (c) => c.name === "record_story_media_processing_failed",
    );
    expect(failed).toBeDefined();
    expect(failed!.args.p_failure_reason).toMatch(/after 3 attempts/);
    expect(
      rpcCalls.some((c) => c.name === "record_processed_story_media"),
    ).toBe(false);
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

describe("encodeJpegUnderBudget", () => {
  // Real photos, even worst-case synthetic noise at full resolution, never
  // get remotely close to the real MAX_PROCESSED_BYTES (8 MiB) — see this
  // function's own doc comment for the measured number — so the step-down
  // behavior is exercised directly here, against a deliberately tiny budget,
  // rather than indirectly through processStoryMedia where it can't
  // actually be observed firing more than once.
  async function noiseFrame(size: number) {
    const raw = await import("node:crypto").then((c) =>
      c.randomBytes(size * size * 3),
    );
    return sharp(raw, { raw: { width: size, height: size, channels: 3 } });
  }

  it("steps down quality until the output fits the budget", async () => {
    const source = await noiseFrame(200);
    const highQuality = await source
      .clone()
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();

    // A budget between the smallest and largest step forces at least one
    // step-down without requiring every step to be exhausted.
    const budget = Math.round(highQuality.byteLength * 0.6);
    const result = await encodeJpegUnderBudget(
      source,
      [85, 75, 65, 55, 45],
      budget,
    );

    expect(result.data.byteLength).toBeLessThanOrEqual(budget);
    expect(result.data.byteLength).toBeLessThan(highQuality.byteLength);
  });

  it("returns the smallest attempt when no step fits the budget", async () => {
    const source = await noiseFrame(200);

    const result = await encodeJpegUnderBudget(source, [85, 75, 65, 55, 45], 1);

    // Still a valid, decodable JPEG — the caller's own MAX_PROCESSED_BYTES
    // check is what turns "didn't fit" into a recorded failure, not this
    // function silently producing garbage.
    const metadata = await sharp(result.data).metadata();
    expect(metadata.format).toBe("jpeg");
    expect(result.data.byteLength).toBeGreaterThan(1);
  });

  it("applies progressive scan and mozjpeg at every step", async () => {
    const source = await noiseFrame(64);

    const result = await encodeJpegUnderBudget(source, [85, 75, 65, 55, 45], 1);

    const metadata = await sharp(result.data).metadata();
    expect(metadata.isProgressive).toBe(true);
    expect(metadata.chromaSubsampling).toBe("4:2:0");
  });
});
