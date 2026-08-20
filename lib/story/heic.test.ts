// @vitest-environment node
//
// server-only throws unconditionally outside Next's own bundler, so it is
// mocked to a no-op here -- same convention as image-pipeline.test.ts.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";

vi.mock("server-only", () => ({}));

const { HeicTranscodeError, transcodeHeicToPng } = await import("./heic");

const heicFixture = readFileSync(
  path.join(__dirname, "__fixtures__", "sample.heic"),
);

describe("transcodeHeicToPng", () => {
  it("decodes a real HEIC file and returns a PNG of the same dimensions", async () => {
    const png = await transcodeHeicToPng(heicFixture);
    const metadata = await sharp(png).metadata();
    expect(metadata.format).toBe("png");
    expect(metadata.width).toBe(240);
    expect(metadata.height).toBe(160);
  });

  // The whole reason this module exists: sharp's prebuilt libvips can read
  // the container but cannot decode the HEVC image inside it. If that ever
  // stops being true (a libvips build with HEVC decoding), this test fails
  // and the WASM decoder can be dropped.
  it("covers a file sharp itself still cannot decode", async () => {
    await expect(sharp(heicFixture).png().toBuffer()).rejects.toThrow();
  });

  it("strips metadata (the transcode carries no EXIF into the stored original)", async () => {
    const png = await transcodeHeicToPng(heicFixture);
    const metadata = await sharp(png).metadata();
    expect(metadata.exif).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
  });

  it("rejects bytes that are not a readable image", async () => {
    await expect(
      transcodeHeicToPng(Buffer.from("not an image at all")),
    ).rejects.toBeInstanceOf(HeicTranscodeError);
  });

  it("rejects a HEIC container whose image data is truncated", async () => {
    await expect(
      transcodeHeicToPng(heicFixture.subarray(0, 200)),
    ).rejects.toBeInstanceOf(HeicTranscodeError);
  });
});
