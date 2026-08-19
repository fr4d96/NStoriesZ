/**
 * Server-authoritative PDF-import validation constants and magic-byte
 * sniffing. Split out of lib/story/pdf-import.ts the same way
 * lib/story/image-validation.ts is split out of lib/story/image-pipeline.ts:
 * this file has no heavy/native dependencies and no `server-only` guard, so
 * it is safe to import from lib/validation/ (which lib/validation/story.ts
 * already establishes is sometimes imported by Client Components for
 * client-side pre-checks) without dragging pdfjs-dist/@napi-rs/canvas into
 * a browser bundle. lib/story/pdf-import.ts (the actual renderer, real
 * "server-only" surface) re-exports these for convenience.
 *
 * No dependency needed for the magic-byte check, matching
 * image-validation.ts's own reasoning — "%PDF-" is a single fixed 5-byte
 * signature, trivially checked without a library.
 */

/**
 * Raw-upload size ceiling for a PDF import. Its own constant, deliberately
 * separate from lib/story/content-import.ts's MAX_IMPORT_INPUT_BYTES
 * (2 MB, sized for pasted text/HTML) — PDFs, especially photo-heavy Canva
 * scrapbook exports, are two orders of magnitude larger. 75 MiB gives
 * headroom above the one real Canva sample measured during the Stage 0.5
 * spike (a 151-page personal scrapbook export, ~57 MB) while still being a
 * bounded rejection point, not unlimited. See
 * docs/pdf-import-spike-findings.md's Stage 0.5 section for the full
 * reasoning, including why this is NOT wired into next.config.ts's Server
 * Action body-size limit (that mechanism only governs the separate
 * text/HTML import Server Action; a file this large needs a Route Handler
 * upload path, same as the existing image pipeline, which is Stage 4's
 * concern).
 *
 * It IS, however, cross-referenced by next.config.ts's
 * PROXY_CLIENT_MAX_BODY_SIZE — a different, transport-level mechanism that
 * does apply to Route Handlers: proxy.ts's matcher covers "/editorial/:path*",
 * and Next silently truncates a proxied request body past 10 MB by default.
 * Keep the two in step; see that constant's comment for the full reasoning.
 */
export const MAX_PDF_IMPORT_INPUT_BYTES = 75 * 1024 * 1024;

/**
 * Preview-thumbnail page-count ceiling — independent from, and much more
 * permissive than, MAX_IMAGES_PER_REVISION (12, image-validation.ts) — see
 * lib/story/pdf-import.ts's own doc comment for the full reasoning (based
 * on real Stage 0.5 timing measurements).
 */
export const MAX_PDF_IMPORT_PAGES = 40;

const PDF_MAGIC = Uint8Array.from(
  "%PDF-".split("").map((c) => c.charCodeAt(0)),
);

/**
 * Mirrors lib/story/image-validation.ts's sniffImageMimeType() posture:
 * never trust a filename or declared MIME type, check the real bytes. A
 * PDF's magic bytes must appear at the very start of the file per this
 * module's (and the plan's) chosen check — a stricter, safer check than
 * the PDF spec's permitted "small amount of leading junk before %PDF-",
 * satisfied by every PDF this product actually needs to accept (a fresh
 * Canva export).
 */
export function isPdfMagicBytes(bytes: Uint8Array): boolean {
  if (bytes.length < PDF_MAGIC.length) return false;
  for (let i = 0; i < PDF_MAGIC.length; i++) {
    if (bytes[i] !== PDF_MAGIC[i]) return false;
  }
  return true;
}
