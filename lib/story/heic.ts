import "server-only";
import sharp from "sharp";
import {
  MAX_INPUT_PIXELS,
  MAX_UPLOAD_BYTES,
} from "@/lib/story/image-validation";

/**
 * HEIC -> JPEG normalization, run at the upload trust boundary (the route
 * handler) BEFORE a storage path is reserved or any row is written.
 *
 * Why here, and not in lib/story/image-pipeline.ts: sharp's prebuilt
 * libvips can parse a HEIC container's metadata but cannot decode one --
 * its bundled libheif has no HEVC decompressor ("Support for this
 * compression format has not been built in"), because the patent-encumbered
 * HEVC decoder is deliberately not shipped in the prebuilt binaries. AVIF
 * (AV1 in the same container) decodes fine; an iPhone photo does not.
 * libheif-js (via heic-decode) is a WASM build that does include it.
 *
 * Normalizing at the boundary keeps HEIC out of every downstream
 * invariant: the private/public buckets' allowed_mime_types, the
 * begin_story_media_upload / record_processed_story_media MIME whitelists,
 * story_media.source_mime_type, and the pipeline's own sniff all continue
 * to see exactly the three formats they already allow. The stored
 * "original" for a HEIC upload is therefore this full-resolution JPEG
 * transcode rather than the HEIC bytes themselves; that original is
 * private staging material only (the published derivative is always a
 * re-encode of it), so nothing user-visible loses fidelity beyond one JPEG
 * generation.
 *
 * JPEG, not PNG: tried PNG first, but a real iPhone photo re-encoded
 * losslessly routinely lands 3-10x the size of an equivalent JPEG (a
 * verified 4284x5712 test photo: 51 MB as PNG vs. 5 MB as JPEG at q90) --
 * enough to blow both MAX_UPLOAD_BYTES and the storage buckets' own
 * file_size_limit (15 MiB, supabase/migrations/
 * 20260804090700_story_media_storage_buckets.sql) for perfectly ordinary
 * uploads. PNG's losslessness buys nothing back here anyway: the HEIC
 * source is already lossy HEVC, so a lossless re-encode of it just spends
 * far more bytes storing the same already-lossy pixels.
 */

/** Distinguishes an unusable HEIC from an infrastructure failure. */
export class HeicTranscodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HeicTranscodeError";
  }
}

/**
 * Decodes a HEIC/HEIF still image and re-encodes it as JPEG.
 *
 * Does NOT pre-check dimensions via a separate sharp().metadata() parse
 * before decoding -- that was tried and removed: sharp's bundled libheif
 * enforces its own hard security ceiling of 16 references in a HEIC
 * container's `iref` box, and an ordinary modern iPhone photo routinely
 * exceeds it (Portrait mode / Deep Fusion / Live Photo all link extra
 * image items -- thumbnail, depth map, portrait matte -- via `iref`),
 * throwing "Security limit exceeded" on files heic-decode (a different,
 * WASM libheif build) opens without issue. Verified directly against a
 * real 3.5 MB iPhone photo that failed this way. The MAX_INPUT_PIXELS
 * decompression-bomb guard is therefore enforced AFTER heic-decode
 * returns real dimensions, not before -- still ahead of the (comparatively
 * expensive) JPEG re-encode, just not ahead of the HEIC decode itself. That
 * is an acceptable narrowing: this endpoint requires an authenticated
 * contributor with edit rights on the revision (never anonymous), and the
 * compressed input is already bounded by MAX_UPLOAD_BYTES before it
 * reaches here.
 */
export async function transcodeHeicToJpeg(
  bytes: Buffer,
): Promise<Buffer<ArrayBuffer>> {
  // Imported lazily: heic-decode pulls in a ~6 MB libheif WASM build, and
  // the overwhelming majority of uploads are not HEIC. Nothing else in the
  // request path pays for it.
  const { default: decodeHeic } = await import("heic-decode");

  let decoded: { width: number; height: number; data: Uint8ClampedArray };
  try {
    decoded = await decodeHeic({ buffer: bytes });
  } catch {
    throw new HeicTranscodeError("This HEIC photo could not be decoded.");
  }

  if (decoded.width * decoded.height > MAX_INPUT_PIXELS) {
    throw new HeicTranscodeError("This photo is too large to process.");
  }

  // libheif applies the container's own rotation/mirror properties (irot,
  // imir) while decoding, so these raw pixels are already upright and the
  // JPEG below needs no EXIF orientation tag -- which matters, because
  // sharp writes no metadata into this output at all.
  let jpeg: Buffer<ArrayBuffer>;
  try {
    jpeg = await sharp(Buffer.from(decoded.data), {
      raw: { width: decoded.width, height: decoded.height, channels: 4 },
      limitInputPixels: MAX_INPUT_PIXELS,
    })
      .jpeg({ quality: 90 })
      .toBuffer();
  } catch {
    throw new HeicTranscodeError("This HEIC photo could not be converted.");
  }

  if (jpeg.byteLength > MAX_UPLOAD_BYTES) {
    throw new HeicTranscodeError(
      "This photo is too large once converted. Please export it as a JPEG first.",
    );
  }
  return jpeg;
}
