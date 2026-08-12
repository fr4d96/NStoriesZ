import { z } from "zod";
import { extractMediaIds } from "@/lib/story/markdown-media";

// --- Safe-link validation -------------------------------------------------
//
// Parser-based, not regex-based: `new URL()` is the single source of truth
// for "what scheme is this," since ad hoc scheme-sniffing regexes are the
// classic way this class of check gets bypassed (mixed-case tricks, encoded
// separators, etc.). Accepts only http(s) absolute URLs or single-slash
// root-relative paths; rejects protocol-relative ("//host/...", which
// browsers treat as absolute), backslashes, control characters, and
// overlong values.
const MAX_HREF_LENGTH = 2048;
const CONTROL_CHAR_REGEX = /[\x00-\x1f\x7f]/;

export function isSafeHref(raw: string): boolean {
  if (
    typeof raw !== "string" ||
    raw.length === 0 ||
    raw.length > MAX_HREF_LENGTH
  ) {
    return false;
  }
  if (CONTROL_CHAR_REGEX.test(raw) || raw.includes("\\")) {
    return false;
  }
  if (raw.startsWith("/")) {
    // Root-relative is safe; "//host/..." is protocol-relative (effectively
    // absolute) and must go through the URL-parsing branch below instead.
    return !raw.startsWith("//");
  }
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

// --- Controlled story content — Markdown text block ------------------------
//
// Engineering Rule 6/7: structured JSON only, never raw/arbitrary HTML.
// `content_json` is still a jsonb array of typed blocks (Rule 6's "defined
// schema of blocks"), but collapses to exactly one block: a sanitized
// Markdown string. The Markdown editor (components/story/story-content-editor.tsx)
// renders this live as you type; the public/preview/moderation renderer
// (content-block-renderer.tsx) parses it with react-markdown/remark-gfm into
// React elements from an AST -- never `dangerouslySetInnerHTML`, and raw
// HTML in the source is never passed through (no rehype-raw), so arbitrary
// HTML still can't reach the page.
//
// Images stay reference-only, exactly as before: a real `![alt](url)` is
// rejected outright below, and the only way to embed an image is the
// non-standard `![[<mediaId>]]` token (lib/story/markdown-media.ts), which
// points at an already-uploaded, already-rights-confirmed
// story_revision_media row. That id must belong to the same revision's
// story_revision_media -- enforced server-side in save_revision_draft (see
// the migration that updated this check for the Markdown schema), not just
// here, since a client could otherwise reference another story's private
// image by guessing/copying its id.
//
// `content_json` itself is a loosely-typed `jsonb` array at the DB layer
// (only `jsonb_typeof(content_json) = 'array'` is checked, confirmed by
// reading supabase/migrations/20260803090200_story_revisions.sql), so no
// migration was needed for this block-shape change beyond the
// reference-integrity check.
const MAX_DOCUMENT_CHARACTERS = 50_000;

// Markdown link syntax: `[text](href)`. Deliberately simple (no nested
// brackets/parens support) -- good enough to extract every link an editor
// or importer could plausibly produce, and a false negative here just means
// a safe-looking link isn't caught (still rejected safely elsewhere), while
// a false positive only over-validates, never under-validates.
const MARKDOWN_LINK_REGEX = /\[[^\]\n]*\]\(([^)\n]*)\)/g;

// Standard `![alt](url)` image syntax is never allowed -- images must use
// the `![[mediaId]]` embed token instead (see the module comment above).
const MARKDOWN_IMAGE_REGEX = /!\[[^\]\n]*\]\([^)\n]*\)/;

// A leading `# ` (h1) is reserved for the story title, never story body
// content -- h2-h6 are fine. Checked per-line, ignoring fenced code blocks
// so a `# ` inside a code sample isn't mistaken for a heading.
function hasH1Heading(markdown: string): boolean {
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^\s{0,3}#\s+\S/.test(line) && !/^\s{0,3}##/.test(line)) {
      return true;
    }
  }
  return false;
}

function markdownLinkHrefs(markdown: string): string[] {
  return Array.from(
    markdown.matchAll(MARKDOWN_LINK_REGEX),
    (match) => match[1],
  );
}

export const storyContentBlockSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("markdown"),
    text: z
      .string()
      .trim()
      .min(1, "Your story needs at least some content.")
      .max(MAX_DOCUMENT_CHARACTERS, {
        message: `Story content is too long (max ${MAX_DOCUMENT_CHARACTERS} characters).`,
      })
      .refine((text) => !hasH1Heading(text), {
        message:
          "Use ## or smaller for headings inside your story — the title is your only # heading.",
      })
      .refine((text) => !MARKDOWN_IMAGE_REGEX.test(text), {
        message:
          "Images can't be pasted as links — use the image button to insert one.",
      })
      .refine(
        (text) => markdownLinkHrefs(text).every((href) => isSafeHref(href)),
        { message: "Links must be http(s) or a root-relative path." },
      ),
  }),
]);

export type StoryContentBlock = z.infer<typeof storyContentBlockSchema>;

/** The single Markdown block's text, or "" if content isn't well-formed. */
export function storyContentText(blocks: StoryContentBlock[]): string {
  return blocks[0]?.type === "markdown" ? blocks[0].text : "";
}

/** Wraps a Markdown string in the one-block content_json shape. */
export function markdownToStoryContent(text: string): StoryContentBlock[] {
  return [{ type: "markdown", text }];
}

/** Every image mediaId embedded in a content_json document, in document order. */
export function imageBlockMediaIds(blocks: StoryContentBlock[]): string[] {
  return extractMediaIds(storyContentText(blocks));
}

export const storyContentSchema = z.array(storyContentBlockSchema).length(1);

// Mirrors supabase/migrations/20260803090200_story_revisions.sql's CHECK
// constraints — duplicated deliberately for fast/friendly form errors; the
// DB constraints (and the immutability trigger) are the non-bypassable
// source of truth per Engineering Rule 3.
export const travelStyles = ["budget", "midRange", "comfort"] as const;

export const revisionInputSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required.").max(200),
    excerpt: z.string().trim().max(500).optional().or(z.literal("")),
    contentJson: storyContentSchema,
    tripStartDate: z.iso.date().optional().or(z.literal("")),
    tripEndDate: z.iso.date().optional().or(z.literal("")),
    tripYear: z.number().int().min(2000).max(2100).optional(),
    travelStyle: z.enum(travelStyles).optional(),
    totalExpenseNzdCents: z.number().int().min(0).optional(),
    contributorNote: z.string().trim().max(2000).optional().or(z.literal("")),
  })
  .refine(
    (data) =>
      !data.tripStartDate ||
      !data.tripEndDate ||
      data.tripStartDate <= data.tripEndDate,
    {
      message: "Trip start date must be on or before the end date.",
      path: ["tripEndDate"],
    },
  );

export type RevisionInput = z.infer<typeof revisionInputSchema>;

// A deliberately looser schema for "start a new draft" — the full
// revisionInputSchema's "at least some content" rule is a save-time /
// submit-time friendliness rule, not something a brand-new, still-empty
// shell revision should be blocked on creating. create_self_service_draft
// itself defaults content_json to '[]'::jsonb server-side.
export const createDraftSchema = z.object({
  title: z.string().trim().min(1, "Title is required.").max(200),
});

export type CreateDraftInput = z.infer<typeof createDraftSchema>;

// Locations/work types/tags — same identifiers set_revision_locations /
// set_revision_work_types / set_revision_tags expect, validated client-side
// before every call (Rule: validate at every trust boundary).
export const revisionLocationSchema = z.object({
  regionId: z.uuid(),
  destinationId: z.uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export const revisionLocationsSchema = z.array(revisionLocationSchema).max(20);

// Work types/tags: each selection is either a reference to an existing
// lookup row, or a contributor-authored "Other" value -- never both/neither
// (mirrors the DB CHECK constraint added alongside custom_label in
// supabase/migrations/20260812110000_work_type_tag_custom_labels.sql).
export const revisionSelectionSchema = z
  .object({
    id: z.uuid().optional(),
    customLabel: z.string().trim().min(1).max(100).optional(),
  })
  .refine((v) => Boolean(v.id) !== Boolean(v.customLabel), {
    message: "Provide either a selection or a custom label, not both.",
  });

export const revisionSelectionsSchema = z
  .array(revisionSelectionSchema)
  .max(20);

export const confirmationMethods = [
  "account",
  "email",
  "written_message",
  "in_person",
  "other",
] as const;

export const identifiablePeopleStates = [
  "confirmed",
  "not_applicable",
  "pending",
  "declined",
] as const;

export const submitRevisionSchema = z.object({
  revisionId: z.uuid(),
  expectedVersion: z.number().int(),
  confirmationMethod: z.enum(confirmationMethods),
  publicationConfirmed: z.literal(true, {
    error: "You must confirm you have permission to publish this story.",
  }),
  // Required (non-defaulted) as of Prompt 4 Sub-phase 4: the caller fetches
  // current_terms_version() immediately before submitting and passes it
  // here, so submit_revision_with_consent() can detect (and reject, via a
  // stable WHV01 error code) a terms-of-service change that happened
  // between the caller loading the form and actually submitting.
  expectedTermsVersion: z.string().trim().min(1, "Missing terms version."),
  imageRightsConfirmed: z.boolean().default(false),
  identifiablePeopleState: z.enum(identifiablePeopleStates).default("pending"),
  editorialAssistanceConfirmed: z.boolean().default(false),
});

export type SubmitRevisionInput = z.infer<typeof submitRevisionSchema>;

export const reportCategories = [
  "misinformation",
  "unsafe_employment_advice",
  "harassment",
  "copyright_privacy",
  "spam_commercial",
  "other",
] as const;

export const createReportSchema = z.object({
  storyId: z.uuid(),
  category: z.enum(reportCategories),
  details: z.string().trim().max(2000).optional().or(z.literal("")),
});

export type CreateReportInput = z.infer<typeof createReportSchema>;
