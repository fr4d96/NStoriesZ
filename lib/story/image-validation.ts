/**
 * Server-authoritative image validation constants and magic-byte sniffing.
 * No dependency needed for the signature check — JPEG/PNG/WebP magic bytes
 * (and the ISO-BMFF `ftyp` brand that identifies an iPhone HEIC) are a
 * handful of fixed byte sequences, trivially checked without pulling in a
 * dedicated library.
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

/**
 * The only formats that are ever *stored* — in either bucket, in
 * story_media.source_mime_type/processed_mime_type, or in the buckets'
 * own allowed_mime_types lists. HEIC is deliberately NOT one of them: it
 * is normalized to JPEG at the upload trust boundary (see
 * lib/story/heic.ts and the upload route), so nothing downstream of that
 * boundary — storage, RLS, the DB functions, the processing pipeline —
 * has to learn a fourth format.
 */
export type AllowedImageMimeType = "image/jpeg" | "image/png" | "image/webp";

/**
 * What an *upload* may arrive as. HEIC (the iPhone camera default since
 * iOS 11) is accepted here and only here; it is transcoded to JPEG before
 * anything is reserved, stored, or recorded.
 */
export type AcceptedUploadMimeType = AllowedImageMimeType | "image/heic";

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

/**
 * `accept` value for the file input, and the client-side pre-check list.
 * The bare extensions matter: several browsers (notably Chrome on Windows,
 * and Android pickers) report an empty `File.type` for `.heic`/`.heif`,
 * so a MIME-only `accept` list silently hides the user's own photos in the
 * file picker.
 */
export const UPLOAD_ACCEPT_ATTRIBUTE = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  ".heic",
  ".heif",
].join(",");

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
 * HEIC/HEIF is ISO base media file format: a `ftyp` box at offset 4,
 * followed by a four-character major brand at offset 8. `heic`/`heix` are
 * the still-image brands an iPhone writes; `heim`/`heis`/`hevc`/`hevx`/
 * `hevm`/`hevs` are the sequence/scalable variants; `mif1`/`msf1` are the
 * generic HEIF brands some tools write as the major brand. `avif`/`avis`
 * are deliberately absent — AVIF is a different codec we do not accept.
 */
const ISO_BMFF_FTYP = [0x66, 0x74, 0x79, 0x70]; // "ftyp" at offset 4
const HEIF_BRANDS = new Set([
  "heic",
  "heix",
  "heim",
  "heis",
  "hevc",
  "hevx",
  "hevm",
  "hevs",
  "mif1",
  "msf1",
]);

function isHeic(bytes: Uint8Array): boolean {
  if (!matchesSignature(bytes, ISO_BMFF_FTYP, 4)) return false;
  if (bytes.length < 12) return false;
  const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
  return HEIF_BRANDS.has(brand);
}

/**
 * Sniffs the magic bytes of a buffer and returns the detected MIME type, or
 * null if it doesn't match any of the three allowed image formats. This is
 * a signature check only — it does not prove the file decodes successfully
 * (see lib/story/image-pipeline.ts for the real decode step).
 *
 * Deliberately does NOT report HEIC: this is the sniffer the storage-facing
 * pipeline uses, and HEIC is never a stored format. Use
 * sniffUploadMimeType() at the upload boundary instead.
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

/**
 * The upload boundary's sniffer: the three stored formats, plus HEIC, which
 * the caller must transcode to JPEG (lib/story/heic.ts) before reserving a
 * path or recording anything. As above, a signature match is not a proof of
 * decodability — it only decides which decode path to attempt.
 */
export function sniffUploadMimeType(
  bytes: Uint8Array,
): AcceptedUploadMimeType | null {
  const stored = sniffImageMimeType(bytes);
  if (stored) return stored;
  return isHeic(bytes) ? "image/heic" : null;
}
