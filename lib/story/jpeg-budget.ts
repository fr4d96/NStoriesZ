import "server-only";
import type { Sharp, OutputInfo } from "sharp";

/**
 * Target-file-size JPEG compression, the same strategy WhatsApp uses instead
 * of one fixed quality: encode at the preferred quality first, and only step
 * down if the result doesn't fit the size budget, rather than either
 * rejecting the input outright or always paying for a conservative low
 * quality. Ordinary photos succeed at the first (highest-quality) step;
 * only unusually dense/detailed images (a wall of fine text, a screenshot
 * full of small UI, a very high-megapixel capture) ever reach a lower one.
 *
 * Shared by lib/story/image-pipeline.ts (the published derivative, budgeted
 * against MAX_PROCESSED_BYTES) and lib/story/heic.ts (the HEIC->JPEG
 * transcode at the upload boundary, budgeted against the larger
 * MAX_UPLOAD_BYTES) so the two never drift into applying different
 * compression to what a reader eventually sees vs. what a HEIC upload gets
 * normalized to before that same pipeline processes it.
 *
 * mozjpeg, progressive, and 4:2:0 chroma subsampling are applied
 * unconditionally at every step, not just as a fallback — all three are
 * free wins with no visual-quality tradeoff at photographic content:
 *   - mozjpeg: true enables trellis quantisation and optimised Huffman
 *     tables (compiled into sharp's bundled libjpeg already, no extra
 *     dependency) — content-adaptive bit allocation that typically cuts
 *     JPEG size 20-30% at equal visual quality, the same technique WhatsApp
 *     applies rather than a single flat quantization table. Measured on a
 *     real production photo (5712x4284 iPhone JPEG, resized to 2000px):
 *     262,883 bytes at quality 85 without it, 188,200 bytes with it.
 *   - progressive: true makes the image render low-resolution-to-sharp as
 *     it downloads, instead of appearing top-to-bottom — the same
 *     progressive-scan behaviour WhatsApp's media viewer relies on.
 *   - chromaSubsampling: "4:2:0" is made explicit rather than left to
 *     sharp's quality-dependent default (which happens to already be 4:2:0
 *     at every quality this codebase uses) — human vision resolves color
 *     detail far worse than brightness detail, so halving chroma
 *     resolution loses little that's visible while cutting real bytes; the
 *     same subsampling WhatsApp's compression uses. Being explicit means
 *     this deliberate choice can't silently flip if a caller's quality
 *     steps ever includes a value above sharp's 90 threshold.
 *
 * Each attempt clones `pipeline` rather than re-running the (comparatively
 * expensive) decode+resize that produced it — `pipeline` is expected to
 * already carry every non-format-specific transform (resize, rotate) the
 * caller wants; this function performs only the encode step.
 *
 * If every step in `qualitySteps` still exceeds `maxBytes`, the smallest
 * (last) attempt is returned rather than throwing — the caller is expected
 * to have its own size check as the actual enforcement/rejection point, the
 * same "did the result actually fit" verification every caller of sharp's
 * own decode/encode already does.
 */
export async function encodeJpegUnderBudget(
  pipeline: Sharp,
  qualitySteps: readonly number[],
  maxBytes: number,
): Promise<{ data: Buffer; info: OutputInfo }> {
  let attempt: { data: Buffer; info: OutputInfo } | undefined;
  for (const quality of qualitySteps) {
    attempt = await pipeline
      .clone()
      .jpeg({
        quality,
        mozjpeg: true,
        progressive: true,
        chromaSubsampling: "4:2:0",
      })
      .toBuffer({ resolveWithObject: true });
    if (attempt.data.byteLength <= maxBytes) return attempt;
  }
  return attempt!;
}
