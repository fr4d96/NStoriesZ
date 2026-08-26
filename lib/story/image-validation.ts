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
 * Raw HEIC input ceiling — higher than MAX_UPLOAD_BYTES on purpose. A real
 * 48-megapixel iPhone HEIC of a detail-dense scene (measured against a
 * genuine complaint: a forest/waterfall photo, exactly the kind of
 * high-frequency content that compresses worst) can land well above 15 MiB
 * while HEVC is still doing its job — that is not a decompression bomb, it
 * is HEIC being a much more efficient codec than the JPEG it gets
 * normalized to (lib/story/heic.ts). Raising this specific ceiling is safe
 * because nothing downstream gets more permissive as a result:
 *   - Decode memory is bounded by MAX_INPUT_PIXELS (pixel count), not
 *     compressed byte size — a HEIC's raw decoded RGBA buffer costs the
 *     same whether the source file was 8 MB or 25 MB.
 *   - The transcoded JPEG this produces is still budgeted against the
 *     ORIGINAL MAX_UPLOAD_BYTES (matching the storage buckets' own
 *     15 MiB file_size_limit,
 *     supabase/migrations/20260804090700_story_media_storage_buckets.sql)
 *     via encodeJpegUnderBudget's quality step-down — this constant only
 *     controls what we are willing to ACCEPT and attempt to compress, not
 *     what can ever be written to storage.
 * JPEG/PNG/WebP keep the smaller MAX_UPLOAD_BYTES ceiling: they have no
 * equivalent step-down-after-the-fact story (a JPEG input this large is
 * already the final format) and no reason to accept a bigger buffer.
 */
export const MAX_HEIC_UPLOAD_BYTES = 30 * 1024 * 1024; // 30 MiB

/**
 * Whether a file's client-reported type/name suggests HEIC, WITHOUT
 * decoding anything. Deliberately unverified — real magic-byte sniffing
 * only happens after the file is fully buffered
 * (sniffUploadMimeType/sniffImageMimeType) — this only decides which raw
 * SIZE ceiling to apply before that buffering happens, not what format is
 * ultimately trusted.
 *
 * Several browsers (notably Safari on iOS) report an empty `File.type` for
 * .heic/.heif files picked from the system Photos library, so the
 * extension is checked as a fallback the same way isAcceptedFile in
 * components/story/image-upload-manager.tsx already did before this was
 * extracted — this is that same check, now shared with the server so the
 * two can never drift onto different size ceilings for the same upload.
 *
 * Safe to get "wrong": a non-HEIC file that spoofs its way past the larger
 * ceiling still fails the real magic-byte sniff moments later, or fails
 * the storage bucket's own file_size_limit if it somehow got that far —
 * both are independent enforcement layers this heuristic cannot weaken.
 * The only cost of a false positive is buffering up to MAX_HEIC_UPLOAD_BYTES
 * instead of MAX_UPLOAD_BYTES before that rejection, on an endpoint that
 * already requires an authenticated contributor with edit rights on the
 * revision — never anonymous.
 */
export function looksLikeHeicUpload(type: string, name: string): boolean {
  if (type === "image/heic" || type === "image/heif") return true;
  return /\.(heic|heif)$/i.test(name);
}

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
