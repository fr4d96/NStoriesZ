import "server-only";
import sharp from "sharp";
import {
  MAX_INPUT_PIXELS,
  MAX_UPLOAD_BYTES,
} from "@/lib/story/image-validation";

/**
 * HEIC -> PNG normalization, run at the upload trust boundary (the route
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
 * "original" for a HEIC upload is therefore this full-resolution PNG
 * transcode rather than the HEIC bytes themselves; that original is
 * private staging material only (the published derivative is always a
 * re-encode of it -- see image-pipeline.ts, which re-encodes any non-PNG
 * source to JPEG for the actual published derivative).
 *
 * PNG is lossless, so it carries no additional generation loss beyond the
 * HEIC source's own HEVC compression -- at the cost of a materially larger
 * intermediate file than a JPEG transcode would produce for the same
 * photographic content (routinely 3-6x). That's why the MAX_UPLOAD_BYTES
 * guard below matters here in a way it barely does for the other two
 * source formats: a large HEIC photo is meaningfully more likely to be
 * rejected post-transcode than a same-resolution JPEG/PNG/WebP upload would
 * be pre-transcode.
 */

/** Distinguishes an unusable HEIC from an infrastructure failure. */
export class HeicTranscodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HeicTranscodeError";
  }
}

/**
 * Decodes a HEIC/HEIF still image and re-encodes it as PNG.
 *
 * Guards, in order: dimensions are read from the container (a parse, not a
 * decode) and checked against MAX_INPUT_PIXELS *before* libheif is asked to
 * allocate a width*height*4 pixel buffer, so a decompression-bomb HEIC is
 * rejected without ever being decoded; the encoded result is then checked
 * against MAX_UPLOAD_BYTES, since a lossless PNG transcode of a HEIC photo
 * can be several times the size of its source.
 */
export async function transcodeHeicToPng(
  bytes: Buffer,
): Promise<Buffer<ArrayBuffer>> {
  let width: number | undefined;
  let height: number | undefined;
  try {
    const metadata = await sharp(bytes, {
      limitInputPixels: MAX_INPUT_PIXELS,
    }).metadata();
    width = metadata.width;
    height = metadata.height;
  } catch {
    throw new HeicTranscodeError("This HEIC photo could not be read.");
  }
  if (!width || !height) {
    throw new HeicTranscodeError("This HEIC photo could not be read.");
  }
  if (width * height > MAX_INPUT_PIXELS) {
    throw new HeicTranscodeError("This photo is too large to process.");
  }

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

  // libheif applies the container's own rotation/mirror properties (irot,
  // imir) while decoding, so these raw pixels are already upright and the
  // PNG below needs no EXIF orientation tag -- which matters, because sharp
  // writes no metadata into this output at all.
  let png: Buffer<ArrayBuffer>;
  try {
    png = await sharp(Buffer.from(decoded.data), {
      raw: { width: decoded.width, height: decoded.height, channels: 4 },
      limitInputPixels: MAX_INPUT_PIXELS,
    })
      .png()
      .toBuffer();
  } catch {
    throw new HeicTranscodeError("This HEIC photo could not be converted.");
  }

  if (png.byteLength > MAX_UPLOAD_BYTES) {
    throw new HeicTranscodeError(
      "This photo is too large once converted. Please export it as a JPEG or PNG first.",
    );
  }
  return png;
}
