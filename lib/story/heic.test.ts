// @vitest-environment node
//
// server-only throws unconditionally outside Next's own bundler, so it is
// mocked to a no-op here -- same convention as image-pipeline.test.ts.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";

vi.mock("server-only", () => ({}));

const { HeicTranscodeError, transcodeHeicToJpeg } = await import("./heic");

const heicFixture = readFileSync(
  path.join(__dirname, "__fixtures__", "sample.heic"),
);

describe("transcodeHeicToJpeg", () => {
  it("decodes a real HEIC file and returns a JPEG of the same dimensions", async () => {
    const jpeg = await transcodeHeicToJpeg(heicFixture);
    const metadata = await sharp(jpeg).metadata();
    expect(metadata.format).toBe("jpeg");
    expect(metadata.width).toBe(240);
    expect(metadata.height).toBe(160);
  });

  // The whole reason this module exists: sharp's prebuilt libvips can read
  // the container but cannot decode the HEVC image inside it. If that ever
  // stops being true (a libvips build with HEVC decoding), this test fails
  // and the WASM decoder can be dropped.
  it("covers a file sharp itself still cannot decode", async () => {
    await expect(sharp(heicFixture).jpeg().toBuffer()).rejects.toThrow();
  });

  // A real regression: sharp's bundled libheif enforces its own hard cap
  // of 16 `iref` box references, which an ordinary modern iPhone photo
  // routinely exceeds (Portrait mode / Deep Fusion / Live Photo all link
  // extra image items -- thumbnail, depth map, portrait matte). transcode
  // must not go through sharp().metadata() to read dimensions before
  // decoding, or every such photo fails here even though heic-decode
  // (a separate WASM libheif build) opens it fine. Reproduced directly
  // against a real photo before this was fixed; this fixture doesn't
  // reproduce the same libheif error, so it only pins the *shape* of the
  // fix -- that sharp.metadata() plays no role in the decode path at all.
  it("does not call sharp().metadata() on the raw HEIC bytes as part of decoding", async () => {
    const metadataSpy = vi.spyOn(sharp.prototype, "metadata");
    await transcodeHeicToJpeg(heicFixture);
    expect(metadataSpy).not.toHaveBeenCalled();
    metadataSpy.mockRestore();
  });

  it("strips metadata (the transcode carries no EXIF into the stored original)", async () => {
    const jpeg = await transcodeHeicToJpeg(heicFixture);
    const metadata = await sharp(jpeg).metadata();
    expect(metadata.exif).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
  });

  it("rejects bytes that are not a readable image", async () => {
    await expect(
      transcodeHeicToJpeg(Buffer.from("not an image at all")),
    ).rejects.toBeInstanceOf(HeicTranscodeError);
  });

  it("rejects a HEIC container whose image data is truncated", async () => {
    await expect(
      transcodeHeicToJpeg(heicFixture.subarray(0, 200)),
    ).rejects.toBeInstanceOf(HeicTranscodeError);
  });
});
