import { describe, expect, it } from "vitest";
import {
  extensionForMimeType,
  looksLikeHeicUpload,
  MAX_HEIC_UPLOAD_BYTES,
  MAX_IMAGES_PER_REVISION,
  MAX_UPLOAD_BYTES,
  sniffImageMimeType,
  sniffUploadMimeType,
  UPLOAD_ACCEPT_ATTRIBUTE,
} from "./image-validation";

/** ISO-BMFF header: 4-byte box size, "ftyp", then the 4-byte major brand. */
function ftypHeader(brand: string): Uint8Array {
  const bytes = new Uint8Array(16);
  bytes.set([0x00, 0x00, 0x00, 0x18], 0);
  bytes.set([0x66, 0x74, 0x79, 0x70], 4);
  for (let i = 0; i < 4; i++) bytes[8 + i] = brand.charCodeAt(i);
  return bytes;
}

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

describe("sniffUploadMimeType", () => {
  it("still reports the three stored formats unchanged", () => {
    expect(sniffUploadMimeType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(
      "image/jpeg",
    );
  });

  it.each(["heic", "heix", "heim", "heis", "hevc", "mif1", "msf1"])(
    "detects an ISO-BMFF still-image brand: %s",
    (brand) => {
      expect(sniffUploadMimeType(ftypHeader(brand))).toBe("image/heic");
    },
  );

  it("rejects AVIF and video brands sharing the same container", () => {
    expect(sniffUploadMimeType(ftypHeader("avif"))).toBeNull();
    expect(sniffUploadMimeType(ftypHeader("avis"))).toBeNull();
    expect(sniffUploadMimeType(ftypHeader("isom"))).toBeNull();
    expect(sniffUploadMimeType(ftypHeader("mp42"))).toBeNull();
    expect(sniffUploadMimeType(ftypHeader("qt  "))).toBeNull();
  });

  it("rejects a truncated ftyp box", () => {
    expect(sniffUploadMimeType(ftypHeader("heic").subarray(0, 10))).toBeNull();
  });
});

describe("sniffImageMimeType", () => {
  // HEIC is never a *stored* format: it is transcoded to JPEG at the upload
  // boundary, so the storage-facing sniffer must keep rejecting it.
  it("does not report HEIC", () => {
    expect(sniffImageMimeType(ftypHeader("heic"))).toBeNull();
  });
});

describe("UPLOAD_ACCEPT_ATTRIBUTE", () => {
  it("includes the bare .heic/.heif extensions, for browsers that report no File.type", () => {
    expect(UPLOAD_ACCEPT_ATTRIBUTE).toContain(".heic");
    expect(UPLOAD_ACCEPT_ATTRIBUTE).toContain(".heif");
    expect(UPLOAD_ACCEPT_ATTRIBUTE).toContain("image/heic");
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

describe("looksLikeHeicUpload", () => {
  it("matches by MIME type", () => {
    expect(looksLikeHeicUpload("image/heic", "photo.dat")).toBe(true);
    expect(looksLikeHeicUpload("image/heif", "photo.dat")).toBe(true);
  });

  // Real-world regression: Safari on iOS reports an empty File.type for
  // .heic/.heif files picked from the system Photos library.
  it("falls back to the file extension when File.type is empty", () => {
    expect(looksLikeHeicUpload("", "IMG_5785.HEIC")).toBe(true);
    expect(looksLikeHeicUpload("", "IMG_5785.heif")).toBe(true);
  });

  it("does not match ordinary image types", () => {
    expect(looksLikeHeicUpload("image/jpeg", "photo.jpg")).toBe(false);
    expect(looksLikeHeicUpload("image/png", "photo.png")).toBe(false);
    expect(looksLikeHeicUpload("image/webp", "photo.webp")).toBe(false);
  });

  // A file that merely claims to be HEIC (wrong type AND wrong extension)
  // is not this function's problem to catch — it only picks a size
  // ceiling; sniffUploadMimeType on the real bytes is what actually
  // decides trust, downstream of this check.
  it("does not match a file with neither a HEIC type nor extension", () => {
    expect(looksLikeHeicUpload("application/octet-stream", "photo.dat")).toBe(
      false,
    );
  });
});

describe("MAX_HEIC_UPLOAD_BYTES", () => {
  // The whole point of this constant: HEIC gets more room than
  // JPEG/PNG/WebP because it has to survive a re-encode into a less
  // efficient format afterward (lib/story/heic.ts) — see this file's own
  // doc comment for why raising it doesn't loosen anything downstream.
  it("is larger than the general upload ceiling", () => {
    expect(MAX_HEIC_UPLOAD_BYTES).toBeGreaterThan(MAX_UPLOAD_BYTES);
  });
});
