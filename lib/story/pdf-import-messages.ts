import type {
  PdfImportError,
  PdfPageRenderError,
} from "@/lib/story/pdf-import";
import type { PdfPageAttachError } from "@/lib/story/pdf-page-attachment";

/**
 * Shared error -> editor-facing copy mapping for both Phase A
 * (pdf-preview/route.ts) and Phase B (pdf-attach/route.ts) of Stage 4,
 * docs/pdf-canva-import-plan.md -- kept in one place, outside either
 * route.ts file, since a Next.js Route Handler module may only export HTTP
 * method handlers and the small set of reserved route-segment config names
 * (`runtime`, `dynamic`, etc.); any other export is a build-time error.
 */
export function pdfImportErrorMessage(
  error: PdfImportError | PdfPageRenderError,
): string {
  switch (error) {
    case "not_a_pdf":
      return "The file is not a PDF.";
    case "input_too_large":
      return "The PDF file is too large.";
    case "corrupt_pdf":
      return "The PDF could not be read (it may be corrupt).";
    case "password_protected":
      return "The PDF is password-protected. Remove the password and try again.";
    case "zero_pages":
      return "The PDF has no pages.";
    case "too_many_pages":
      return "The PDF has too many pages to preview.";
    case "render_failed":
      return "One or more pages could not be rendered.";
    case "invalid_page_numbers":
      return "One or more selected pages are not in this PDF. Reload the preview and try again.";
    default: {
      const exhaustive: never = error;
      return `Could not process the PDF (${exhaustive}).`;
    }
  }
}

/** Phase B's own attach-step errors (lib/story/pdf-page-attachment.ts),
 * layered on top of the render errors above. */
export function pdfPageAttachErrorMessage(error: PdfPageAttachError): string {
  switch (error) {
    case "too_many_pages_selected":
      return "Select at most 12 pages to attach.";
    case "capacity_exceeded":
      return "This draft already has too many images attached to add these pages.";
    case "unauthorized":
      return "You do not have access to this draft.";
    case "attach_failed":
      return "Could not attach the selected pages. Please try again.";
    default:
      return pdfImportErrorMessage(error);
  }
}
