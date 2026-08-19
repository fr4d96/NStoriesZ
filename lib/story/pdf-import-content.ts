/**
 * Stage 3 of docs/pdf-canva-import-plan.md: assembles the minimal
 * `content_json` document and default title for a PDF import, from the
 * mediaIds Stage 2 (`lib/story/pdf-page-attachment.ts`) already attached to
 * a revision -- nothing here reads the PDF itself. Per the plan's pivot
 * (see the "Revision history" section at the top of the plan doc), this
 * module deliberately does NOT attempt any heading/paragraph reconstruction
 * or text derivation from the PDF's actual content -- only the mediaId
 * list Stage 2 produced (in selected-page order) and the uploaded
 * filename, for the title.
 *
 * Kept as a separate module from pdf-page-attachment.ts (rather than
 * folded into `attachPdfPagesToRevision`'s return shape) so Stage 2's
 * existing, already-passing tests don't need to change for a concern
 * (content_json assembly) that's orthogonal to Stage 2's job (rendering +
 * uploading through the image pipeline). Stage 4 (not built here) is
 * expected to call `attachPdfPagesToRevision()` and then this module's
 * `buildPdfImportContent()` back to back, composing the two results itself
 * -- e.g. `buildPdfImportContent(attached.map((a) => a.mediaId), filename)`.
 */
import { mediaEmbedToken } from "@/lib/story/markdown-media";
import {
  markdownToStoryContent,
  type StoryContentBlock,
} from "@/lib/validation/story";

/**
 * Same fallback literal `app/(contributor)/stories/new/new-story-chooser.tsx`
 * uses when starting a brand-new draft with no title yet -- reused here
 * rather than inventing a second "no title available" string.
 */
export const DEFAULT_PDF_IMPORT_TITLE = "Untitled story";

/**
 * Mirrors `revisionInputSchema`'s `title` field (`lib/validation/story.ts`),
 * `.max(200)`. Kept as its own named constant here (rather than importing
 * the schema just to read a number off it) so this module's truncation
 * logic is self-documenting; if that schema's limit ever changes, the two
 * numbers drifting apart would surface immediately as a failing
 * `storyContentSchema`/`revisionInputSchema` round-trip test below.
 */
const MAX_TITLE_LENGTH = 200;

/** Shown above the imported page images -- an honest placeholder, never
 * invented narrative text, that makes it obvious to the editor that real
 * story text still needs to be written. Matches the exact wording the plan
 * doc proposes. */
const PLACEHOLDER_BODY_TEXT = "Imported from PDF — add your story text here.";

// Matches everything `storyContentBlockSchema`'s markdown block name-strips
// on submit day-to-day plus a bare extension-splitter; deliberately simple
// (this is filename cosmetics, not a security boundary -- the schema's own
// trim/length/h1/image/link refinements are what actually gate storage).
const FILENAME_EXTENSION_REGEX = /\.[^./\\]+$/;
const CONTROL_CHARS_REGEX = /[\x00-\x1f\x7f]/g;
const SEPARATOR_CHARS_REGEX = /[_/\\]+/g;
const WHITESPACE_RUN_REGEX = /\s+/g;

/**
 * Derives a human-readable default title from an uploaded PDF's filename:
 * strips the extension, drops control characters, folds common filename
 * separators (`_`, `/`, `\`) to spaces, collapses whitespace, trims, and
 * truncates to the same 200-character limit `revisionInputSchema.title`
 * enforces. Falls back to `DEFAULT_PDF_IMPORT_TITLE` ("Untitled story", the
 * same literal `start-new-story.tsx` uses) when the filename is missing,
 * empty, only an extension, or reduces to nothing usable after cleanup
 * (e.g. a name that was only control characters/whitespace). The same
 * literal `new-story-chooser.tsx` uses as its blank-draft title default.
 */
export function titleFromPdfFilename(filename?: string | null): string {
  if (!filename) return DEFAULT_PDF_IMPORT_TITLE;

  const withoutExtension = filename.replace(FILENAME_EXTENSION_REGEX, "");
  const cleaned = withoutExtension
    .replace(CONTROL_CHARS_REGEX, " ")
    .replace(SEPARATOR_CHARS_REGEX, " ")
    .replace(WHITESPACE_RUN_REGEX, " ")
    .trim();

  if (!cleaned) return DEFAULT_PDF_IMPORT_TITLE;

  return cleaned.length > MAX_TITLE_LENGTH
    ? cleaned.slice(0, MAX_TITLE_LENGTH).trim()
    : cleaned;
}

export type PdfImportContent = {
  title: string;
  contentJson: StoryContentBlock[];
};

/**
 * Assembles the minimal `content_json` for a PDF import: the placeholder
 * instructional line, then one `![[mediaId]]` embed token
 * (`lib/story/markdown-media.ts`) per attached page, in the exact order
 * `mediaIds` is given in -- callers must pass Stage 2's attached-page
 * mediaIds already in selected-page order (`AttachedPdfPage.mediaId`,
 * sorted by page order), since this function does no reordering of its
 * own. Round-trips through `storyContentSchema.safeParse()` by
 * construction (verified in this module's tests): the placeholder text
 * keeps the markdown block's `.min(1)` text rule satisfied even though
 * there's no real narrative text yet, no `# ` h1 line is ever produced, the
 * `![[...]]` embed syntax is exempt from the standard-Markdown-image
 * rejection (that rule only matches `![...](...)`), and no markdown links
 * are produced to trip the safe-href check.
 *
 * `mediaIds` is expected to be non-empty in practice -- Stage 2's
 * `attachPdfPagesToRevision()` rejects a zero-page selection outright
 * (`"too_many_pages_selected"`), so this function is never actually called
 * downstream with an empty list. It's still handled gracefully rather than
 * throwing: an empty list produces the placeholder text alone, which is
 * still valid, submittable content_json (just an image-less "story" an
 * editor would need to fix before submitting for other reasons anyway).
 */
export function buildPdfImportContent(
  mediaIds: string[],
  filename?: string | null,
): PdfImportContent {
  const embeds = mediaIds.map((mediaId) => mediaEmbedToken(mediaId));
  const text =
    embeds.length > 0
      ? `${PLACEHOLDER_BODY_TEXT}\n\n${embeds.join("\n\n")}`
      : PLACEHOLDER_BODY_TEXT;

  return {
    title: titleFromPdfFilename(filename),
    contentJson: markdownToStoryContent(text),
  };
}
