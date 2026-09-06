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

// Custom message on the array-length check itself, not just the inner run
// text's -- a genuinely empty document (content_json === '[]', the shape
// create_self_service_draft() starts every new story with) fails THIS
// check, not the per-run "Your story needs at least some content." one a
// few lines up, and Zod's own default message for .length() ("Too small:
// expected array to have >=1 items") was surfacing verbatim in the editor
// on the very first keystroke in any other field of a still-content-less
// New Story -- confirmed live before writing this fix, not assumed.
export const storyContentSchema = z
  .array(storyContentBlockSchema)
  .length(1, "Your story needs at least some content.");

/**
 * The same content rules, minus "there has to be some" -- for SAVING a
 * draft, as opposed to importing one or submitting it.
 *
 * WHY THIS EXISTS. Every field on the editor's debounced "fields" save
 * (title, sub-title, travel style, total expenses, contributor note) goes
 * through revisionInputSchema in ONE parse, so `contentJson` failing took
 * the whole payload down with it. On a story with no body text yet -- which
 * is every story for as long as it takes to get from step 1 to step 2 --
 * that meant nothing on step 1 could be saved at all: the editor showed
 * "Your story needs at least some content." and silently kept "Not saved
 * yet". Confirmed live before this fix, and confirmed in the database
 * afterwards (`excerpt` stayed NULL on a real draft while the field on
 * screen had text in it).
 *
 * The timeline makes that unavoidable rather than unlikely: step 1 is
 * Title, step 2 is Your story, so following the steps in order is exactly
 * the path that hits it. createDraftSchema below already says the quiet
 * part -- "at least some content" is a save-time/submit-time rule, not
 * something an empty shell revision should be blocked on.
 *
 * WHAT THIS DOES NOT RELAX. Empty-text blocks are dropped rather than
 * accepted, so a document is either genuinely empty or a real block that
 * still faces every original rule: length ceiling, the no-H1 rule, the
 * no-pasted-image-links rule, and the safe-href rule. `storyContentSchema`
 * itself is untouched and stays strict for the paths where "must have
 * content" is the actual requirement -- PDF/HTML/legacy import and paste.
 *
 * AND IT DOES NOT WEAKEN SUBMIT (Engineering Rules 2/3). An empty story
 * still cannot be submitted: the UI gate is missingStoryRequirements()
 * (lib/story/steps.ts) and the non-bypassable one is
 * submit_revision_with_consent(), which has required real content in the
 * database since 20260902090000_submit_requires_story_content.sql. This
 * only changes what may be SAVED while still being written.
 */
export const draftContentSchema = z.preprocess(
  (value) => {
    if (!Array.isArray(value)) return value;
    return value.filter(
      (block) =>
        !(
          block !== null &&
          typeof block === "object" &&
          (block as { type?: unknown }).type === "markdown" &&
          typeof (block as { text?: unknown }).text === "string" &&
          (block as { text: string }).text.trim() === ""
        ),
    );
  },
  z
    .array(storyContentBlockSchema)
    .max(1, "A story has a single content block."),
);

// Mirrors supabase/migrations/20260803090200_story_revisions.sql's CHECK
// constraints — duplicated deliberately for fast/friendly form errors; the
// DB constraints (and the immutability trigger) are the non-bypassable
// source of truth per Engineering Rule 3.
export const travelStyles = ["budget", "midRange", "comfort"] as const;

// travel_style is a loosely-typed `text` column with no DB enum/CHECK
// (confirmed by reading supabase/migrations/20260803090200_story_revisions.sql
// before writing this) -- travelStyles above are curated presets offered in
// the UI, not an exhaustive allowlist. A contributor's own wording (the
// edit form's "Other" option) is just as valid a stored value, bounded to
// the same length as other short free-text fields on this form.
const TRAVEL_STYLE_MAX_LENGTH = 50;

/**
 * The one wording for "your end date is before your start date", exported so
 * the authoring form's trip-date control can echo it inline next to the two
 * fields instead of only in the save-error banner at the top of a long form.
 * The refine() below stays the enforcer -- nothing saves while the range is
 * inverted -- so this is a single shared string, not a second rule.
 */
export const TRIP_DATE_ORDER_MESSAGE =
  "Trip start date must be on or before the end date.";

export const revisionInputSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required.").max(200),
    excerpt: z.string().trim().max(500).optional().or(z.literal("")),
    // draftContentSchema, NOT storyContentSchema -- see its comment above.
    // This schema is the DRAFT-SAVE boundary (the editor's autosave and
    // saveRevisionFieldsAction); requiring content here blocked every other
    // field on the same payload from saving on a story not yet written.
    contentJson: draftContentSchema,
    tripStartDate: z.iso.date().optional().or(z.literal("")),
    tripEndDate: z.iso.date().optional().or(z.literal("")),
    tripYear: z.number().int().min(2000).max(2100).optional(),
    travelStyle: z
      .string()
      .trim()
      .max(TRAVEL_STYLE_MAX_LENGTH)
      .optional()
      .or(z.literal("")),
    totalExpenseNzdCents: z.number().int().min(0).optional(),
    contributorNote: z.string().trim().max(2000).optional().or(z.literal("")),
  })
  .refine(
    (data) =>
      !data.tripStartDate ||
      !data.tripEndDate ||
      data.tripStartDate <= data.tripEndDate,
    {
      message: TRIP_DATE_ORDER_MESSAGE,
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

// Locations/tags — same identifiers set_revision_locations /
// set_revision_tags expect, validated client-side before every call
// (Rule: validate at every trust boundary).
export const revisionLocationSchema = z.object({
  regionId: z.uuid(),
  destinationId: z.uuid().nullable().optional(),
  /**
   * A place the contributor typed, for somewhere not in `destinations`
   * (20260903140000). Mutually exclusive with destinationId, and BOTH being
   * absent stays valid -- that is a region-only location, which is the most
   * common shape in the data today. `destinations` holds a sample of New
   * Zealand's towns, not a list of them.
   */
  customDestinationLabel: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .nullable()
    .optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export const revisionLocationsSchema = z.array(revisionLocationSchema).max(20);

/**
 * Per-revision tag cap, mirrored from set_revision_tags()'s own constant.
 * Generous but not unbounded: it matches the cap already applied to
 * locations, and 20 topical labels on one story is well past the point where
 * tags describe a story rather than keyword-stuff it.
 */
export const MAX_TAGS_PER_REVISION = 20;

/** Matches story_revision_tags_one_of's CHECK on custom_label length. */
export const TAG_MAX_LENGTH = 100;

// Tags — the platform's only story taxonomy as of 2026-08-16 (work types
// are retired; see supabase/migrations/20260816100100_curate_whv_tags_retire_work_types.sql).
// Each selection is either a reference to an existing lookup row, or a
// contributor-authored label -- never both/neither (mirrors the DB CHECK
// constraint added alongside custom_label in
// supabase/migrations/20260812110000_work_type_tag_custom_labels.sql).
export const revisionTagSchema = z
  .object({
    id: z.uuid().optional(),
    customLabel: z.string().trim().min(1).max(TAG_MAX_LENGTH).optional(),
  })
  .refine((v) => Boolean(v.id) !== Boolean(v.customLabel), {
    message: "Provide either a selection or a custom label, not both.",
  });

// A contributor may add as many tags as they like, up to a generous cap.
// This is the friendly client-side mirror only: set_revision_tags() applies
// the same 20 server-side, deduplicates case-insensitively, and folds a
// typed label naming an existing tag into a reference to it -- it, not this,
// is the enforcing boundary (Engineering Rule 3).
export const revisionTagsSchema = z
  .array(revisionTagSchema)
  .max(MAX_TAGS_PER_REVISION, {
    message: `You can add up to ${MAX_TAGS_PER_REVISION} tags to a story.`,
  });

/**
 * Optional per-category expense breakdown (2026-09-02). The lump
 * `totalExpenseNzdCents` above stays the headline number and stays
 * independent of this -- a partial breakdown is the normal case, not an
 * error, so nothing here (and nothing in the database) requires the
 * categories to add up to the total. "The categories exceed the stated
 * total" is an advisory finding in lib/story/content-quality-checks.ts.
 *
 * Categories are CURATED -- there is deliberately no `customLabel` escape
 * hatch like tags have. A tag labels one story; an expense exists to be
 * added up across stories, and free text ("car" / "van stuff" / "vehicle")
 * makes that impossible. The `other` category plus `note` carries the rest.
 */
export const EXPENSE_NOTE_MAX_LENGTH = 120;

/**
 * One row per category is all the table allows
 * (story_revision_expenses_one_per_category), so this cap is really just
 * "no more rows than there are categories" with generous headroom -- it
 * exists so an array schema can never be handed something unbounded.
 *
 * NOT the product cap. A breakdown holds five rows (MAX_EXPENSE_ROWS in
 * components/story/expense-breakdown.tsx), enforced in the form and again in
 * set_revision_expenses(), which TRUNCATES rather than raising so a
 * background autosave never starts erroring. Rejecting at 6 here would turn
 * that graceful truncation into a hard save failure.
 */
export const MAX_EXPENSE_ROWS_PER_REVISION = 40;

/** Matches story_revision_expenses' own CHECK on custom_label length. */
export const EXPENSE_LABEL_MAX_LENGTH = 60;

/**
 * One expense row. EITHER a curated category reference OR a
 * contributor-typed label (20260903110000) -- the same either/or shape
 * story_revision_tags has, and the database enforces it with a CHECK.
 *
 * `categoryId` was a required uuid until custom labels landed, which
 * rejected the entire array the moment one typed row appeared: the server
 * action returned "Invalid expenses." and nothing reached the RPC. The
 * database was provably correct the whole time -- the RLS suite calls the
 * RPC directly and passed -- so the break lived only in this layer, and only
 * an end-to-end check surfaced it.
 */
export const revisionExpenseSchema = z
  .object({
    categoryId: z.uuid().nullable().optional(),
    customLabel: z
      .string()
      .trim()
      .min(1)
      .max(EXPENSE_LABEL_MAX_LENGTH)
      .nullable()
      .optional(),
    // Cents, non-negative. An empty amount is not zero: the form drops such a
    // row before it ever reaches here, and set_revision_expenses() drops it
    // again server-side, so "I didn't record it" is never stored as "it cost
    // nothing".
    amountNzdCents: z.number().int().min(0),
    note: z.string().trim().max(EXPENSE_NOTE_MAX_LENGTH).nullable().optional(),
  })
  .refine((row) => Boolean(row.categoryId) || Boolean(row.customLabel), {
    message: "An expense row needs a category or a name.",
    path: ["categoryId"],
  });

export const revisionExpensesSchema = z
  .array(revisionExpenseSchema)
  .max(MAX_EXPENSE_ROWS_PER_REVISION);

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
  // .positive(), not just .int() -- see lib/validation/moderation.ts's
  // "Server Action input schemas" header for the full reasoning: callers
  // coerce with Number(), Number(null) is 0, and stories.version is always
  // >= 1, so 0 or negative can only mean a malformed request.
  expectedVersion: z.number().int().positive(),
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

/**
 * A contributor withdrawing their OWN published story
 * (revoke_publication_consent(), backing
 * app/(contributor)/my-stories/actions.ts#withdrawPublishedStoryAction).
 *
 * Deliberately reason-free: docs/content-governance.md "Corrections,
 * withdrawal, and deletion" treats a contributor taking their own story down
 * as their decision to make, not one they owe an explanation for — the
 * asymmetry with archiveStorySchema's REQUIRED reason (a staff takedown, a
 * user-facing decision about someone else's work) is the governance rule,
 * not an oversight. The audit table enforces the same split with a check
 * constraint, so this schema cannot drift from it silently.
 *
 * `expectedVersion` is the optimistic-concurrency token the client last saw,
 * not an authorization input: the RPC compares it against the row's real
 * version and refuses a stale one. Ownership and publication state are
 * re-derived server-side by the action (and again, non-bypassably, by the
 * RPC) — never read from here. `.positive()` for the same reason as every
 * other schema in this codebase; see lib/validation/moderation.ts's
 * "Server Action input schemas" header.
 */
export const withdrawStorySchema = z.object({
  storyId: z.uuid(),
  expectedVersion: z.number().int().positive(),
});

export type WithdrawStoryInput = z.infer<typeof withdrawStorySchema>;

/**
 * Asking for a takedown. The note is OPTIONAL on purpose: a contributor is
 * not required to justify withdrawing their own story (docs/content-
 * governance.md), and the database agrees -- request_story_takedown() takes
 * a nullable note. Bounded to the column's own 2000-character ceiling.
 */
export const TAKEDOWN_NOTE_MAX_LENGTH = 2000;

export const requestTakedownSchema = z.object({
  storyId: z.uuid(),
  expectedVersion: z.number().int().positive(),
  note: z
    .string()
    .trim()
    .max(TAKEDOWN_NOTE_MAX_LENGTH)
    .optional()
    .or(z.literal("")),
});

export type RequestTakedownInput = z.infer<typeof requestTakedownSchema>;

export const cancelTakedownSchema = z.object({ requestId: z.uuid() });

/**
 * A moderator's decision. Declining REQUIRES a note -- the contributor reads
 * it, and "no" without a reason is not an answer. Approving does not: the
 * contributor already said what they wanted, and making a moderator write
 * prose to agree adds friction to the outcome that honours consent. The RPC
 * enforces the same asymmetry, non-bypassably.
 */
export const decideTakedownSchema = z
  .object({
    requestId: z.uuid(),
    approve: z.boolean(),
    note: z
      .string()
      .trim()
      .max(TAKEDOWN_NOTE_MAX_LENGTH)
      .optional()
      .or(z.literal("")),
  })
  .refine((d) => d.approve || Boolean(d.note && d.note.trim()), {
    message: "Say why you're declining — the contributor sees this.",
    path: ["note"],
  });

export type DecideTakedownInput = z.infer<typeof decideTakedownSchema>;

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
