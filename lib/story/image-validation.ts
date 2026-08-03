/**
 * Server-authoritative image validation constants and magic-byte sniffing.
 * No dependency needed for the signature check — JPEG/PNG/WebP magic bytes
 * are a handful of fixed byte sequences, trivially checked without pulling
 * in a dedicated library for three fixed signatures.
 *
 * This is only the FIRST of several checks the real pipeline runs
 * (lib/story/image-pipeline.ts) — magic bytes prove "this looks like an
 * image container," not "this decodes to a safe, valid image." A decode
 * failure, a decompression-bomb-sized pixel buffer, or an animated source
 * are all rejected later, during actual processing, not here.
 */

export const MAX_IMAGES_PER_REVISION = 12;
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MiB — raw upload ceiling
export const MAX_PROCESSED_BYTES = 8 * 1024 * 1024; // 8 MiB — re-encoded output ceiling
export const MAX_INPUT_PIXELS = 50_000_000; // ~50 megapixels — decompression-bomb guard
export const MAX_PROCESSED_DIMENSION = 2000; // long-edge cap for the processed derivative

export type AllowedImageMimeType = "image/jpeg" | "image/png" | "image/webp";

const MIME_TO_EXTENSION: Record<AllowedImageMimeType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Extension is derived strictly from a server-detected MIME type — never
 * from a client filename or Content-Type header.
 */
export function extensionForMimeType(mimeType: AllowedImageMimeType): string {
  return MIME_TO_EXTENSION[mimeType];
}

const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// RIFF....WEBP — bytes 0-3 are "RIFF", bytes 8-11 are "WEBP".
const WEBP_RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP_MARKER = [0x57, 0x45, 0x42, 0x50];

function matchesSignature(
  bytes: Uint8Array,
  signature: number[],
  offset = 0,
): boolean {
  if (bytes.length < offset + signature.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (bytes[offset + i] !== signature[i]) return false;
  }
  return true;
}

/**
 * Sniffs the magic bytes of a buffer and returns the detected MIME type, or
 * null if it doesn't match any of the three allowed image formats. This is
 * a signature check only — it does not prove the file decodes successfully
 * (see lib/story/image-pipeline.ts for the real decode step).
 */
export function sniffImageMimeType(
  bytes: Uint8Array,
): AllowedImageMimeType | null {
  if (matchesSignature(bytes, JPEG_SIGNATURE)) return "image/jpeg";
  if (matchesSignature(bytes, PNG_SIGNATURE)) return "image/png";
  if (
    matchesSignature(bytes, WEBP_RIFF) &&
    matchesSignature(bytes, WEBP_MARKER, 8)
  ) {
    return "image/webp";
  }
  return null;
}
