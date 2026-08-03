import { describe, expect, it } from "vitest";
import {
  extensionForMimeType,
  MAX_IMAGES_PER_REVISION,
  sniffImageMimeType,
} from "./image-validation";

describe("sniffImageMimeType", () => {
  it("detects a JPEG signature", () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(sniffImageMimeType(bytes)).toBe("image/jpeg");
  });

  it("detects a PNG signature", () => {
    const bytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
    ]);
    expect(sniffImageMimeType(bytes)).toBe("image/png");
  });

  it("detects a WebP signature (RIFF....WEBP)", () => {
    const bytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ]);
    expect(sniffImageMimeType(bytes)).toBe("image/webp");
  });

  it("rejects a RIFF file that isn't WEBP (e.g. a WAV file)", () => {
    const bytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
    ]);
    expect(sniffImageMimeType(bytes)).toBeNull();
  });

  it("rejects a GIF (unsupported format) even though it has a real signature", () => {
    const bytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    expect(sniffImageMimeType(bytes)).toBeNull();
  });

  it("rejects an empty or truncated buffer", () => {
    expect(sniffImageMimeType(new Uint8Array([]))).toBeNull();
    expect(sniffImageMimeType(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });

  it("rejects a non-image file whose bytes coincidentally start similarly", () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0x00, 0x00]);
    expect(sniffImageMimeType(bytes)).toBeNull();
  });
});

describe("extensionForMimeType", () => {
  it("maps each allowed MIME type to its extension", () => {
    expect(extensionForMimeType("image/jpeg")).toBe("jpg");
    expect(extensionForMimeType("image/png")).toBe("png");
    expect(extensionForMimeType("image/webp")).toBe("webp");
  });
});

describe("MAX_IMAGES_PER_REVISION", () => {
  it("matches the DB-enforced limit (12) documented in CLAUDE.md", () => {
    expect(MAX_IMAGES_PER_REVISION).toBe(12);
  });
});
