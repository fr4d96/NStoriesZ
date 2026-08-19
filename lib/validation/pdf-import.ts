import { z } from "zod";
import {
  isPdfMagicBytes,
  MAX_PDF_IMPORT_INPUT_BYTES,
} from "@/lib/story/pdf-validation";
import { MAX_IMAGES_PER_REVISION } from "@/lib/story/image-validation";

/**
 * Upload-boundary validation for a PDF import (Stage 1,
 * docs/pdf-canva-import-plan.md). Mirrors this directory's existing
 * "one schema per trust boundary, safeParse, never throw" convention
 * (lib/validation/moderation.ts) — this is a new trust boundary per the
 * Definition of Done, not an extension of an existing one.
 *
 * Imports from lib/story/pdf-validation.ts, NOT lib/story/pdf-import.ts —
 * the latter is a real `server-only` module with a native-binary/WASM PDF
 * renderer as a static dependency, which must never end up reachable from a
 * Client Component's bundle (this repo's lib/validation/ modules are
 * sometimes imported client-side for fast pre-checks, e.g.
 * lib/validation/story.ts from story-edit-form.tsx). pdf-validation.ts
 * holds only the dependency-free constant + magic-byte check, safe to
 * import from anywhere.
 *
 * Deliberately re-checks bytes here even though lib/story/pdf-import.ts's
 * renderPagePreviews() re-checks size/magic-bytes itself — Engineering
 * Rule 2/3: never trust a single checkpoint, and this schema exists so a
 * Server Action/Route Handler input boundary has a real Zod schema to
 * parse against (this codebase's established validation posture), not so
 * pdf-import.ts can skip its own checks.
 */
export const pdfImportFileSchema = z.object({
  bytes: z
    .instanceof(Uint8Array)
    .refine((bytes) => bytes.byteLength > 0, {
      message: "The PDF file is empty.",
    })
    .refine((bytes) => bytes.byteLength <= MAX_PDF_IMPORT_INPUT_BYTES, {
      message: "The PDF file is too large.",
    })
    .refine((bytes) => isPdfMagicBytes(bytes), {
      message: "The file is not a PDF (magic bytes did not match).",
    }),
});

export type PdfImportFileInput = z.infer<typeof pdfImportFileSchema>;

/**
 * Stage 4's Phase B page-selection boundary
 * (app/(editor)/editorial/new/pdf-attach/route.ts): the editor's chosen page
 * numbers, decoded from the client's JSON-encoded `pageNumbers` form field.
 * Bounded by the same MAX_IMAGES_PER_REVISION cap
 * (lib/story/image-validation.ts) `attachPdfPagesToRevision()` itself
 * re-enforces -- this schema exists so the Route Handler has a real trust
 * boundary to parse against (this codebase's established posture) before
 * ever calling that function, not so the function can skip its own check.
 * Does NOT validate the numbers against the PDF's actual page count --
 * that's only knowable after re-parsing the re-uploaded PDF bytes, which
 * `renderPagesAtFullQuality()` (via `attachPdfPagesToRevision()`) already
 * does server-side and rejects with `invalid_page_numbers` if any selected
 * page is out of range (Engineering Rule 2: never trust a client-supplied
 * selection blindly).
 */
export const pdfImportPageNumbersSchema = z
  .array(z.number().int().min(1))
  .min(1, "Select at least one page.")
  .max(
    MAX_IMAGES_PER_REVISION,
    `Select at most ${MAX_IMAGES_PER_REVISION} pages.`,
  );

export type PdfImportPageNumbers = z.infer<typeof pdfImportPageNumbersSchema>;

/**
 * Stage 5's alt-text boundary (app/(editor)/editorial/new/pdf-attach/route.ts):
 * the editor-written alt text collected per selected page in the picker UI,
 * decoded from the client's JSON-encoded `altText` form field --
 * `{"<pageNumber>": "<alt text>", ...}`. Keys are plain page numbers (as
 * strings, since JSON object keys are always strings) rather than mediaIds,
 * because the client only learns each page's mediaId after this same
 * request attaches it -- matching `pdfImportPageNumbersSchema` just above.
 *
 * This is a UX nicety layered on top of, never a replacement for, the
 * existing submit-time `missingRequirements` alt-text gate
 * (app/(contributor)/stories/[id]/preview/page.tsx) -- a page whose number
 * doesn't appear here (or whose entry fails this schema) simply stays
 * without alt text (decorative=true, the same placeholder every attached
 * page already gets per Stage 2), not a request failure. The route handler
 * treats a wholly-missing or malformed `altText` field the same way, for
 * the same reason -- see that route's own comment.
 */
export const pdfImportAltTextSchema = z.record(
  z.string(),
  z.string().trim().min(1).max(500),
);

export type PdfImportAltText = z.infer<typeof pdfImportAltTextSchema>;
