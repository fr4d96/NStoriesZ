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
  storage: {
    from: (bucket: string) => ({
      download: async (path: string) => {
        const buf = objects.get(key(bucket, path));
        if (!buf) return { data: null, error: new Error("not found") };
        return {
          data: {
            arrayBuffer: async () =>
              buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
          },
          error: null,
        };
      },
      upload: async (path: string, body: Buffer | Blob) => {
        // The real code uploads a Blob (see the comment on uploadObject() in
        // lib/story/image-pipeline.ts for why), not a raw Buffer -- mirror
        // that here rather than assuming the arg shape.
        const bytes =
          body instanceof Blob
            ? Buffer.from(await body.arrayBuffer())
            : Buffer.from(body);
        objects.set(key(bucket, path), bytes);
        return { error: null };
      },
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

const { processStoryMedia } = await import("./image-pipeline");

beforeEach(() => {
  objects.clear();
  rpcCalls.length = 0;
  mediaRow = null;
  fakeAdmin.rpc.mockClear();
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
