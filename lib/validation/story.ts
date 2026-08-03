import { z } from "zod";

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

// --- Controlled story content — block/run/mark schema ---------------------
//
// Engineering Rule 6/7: structured JSON only, never raw/arbitrary HTML. No
// inline image blocks: images render as an ordered gallery from
// story_revision_media, kept deliberately separate from content_json (see
// docs/architecture.md). Each block's text is an array of "runs" rather than
// a bare string so inline marks (bold/italic/link) can apply to part of a
// block's text — this is a deliberate extension beyond Prompt 3's original
// plain-string shape; the `content_json` column itself is a loosely-typed
// `jsonb` array (only `jsonb_typeof(content_json) = 'array'` is checked at
// the DB layer, confirmed by reading
// supabase/migrations/20260803090200_story_revisions.sql), so no migration
// is needed for this change — only this schema and everything that
// builds/reads content_json.

const MAX_MARKS_PER_RUN = 3; // bold + italic + link, each at most once
const MAX_RUNS_PER_BLOCK = 100;
const MAX_DOCUMENT_CHARACTERS = 50_000;

const linkMarkSchema = z.object({
  type: z.literal("link"),
  href: z.string().refine(isSafeHref, {
    message: "Links must be http(s) or a root-relative path.",
  }),
});

const markSchema = z.union([
  z.literal("bold"),
  z.literal("italic"),
  linkMarkSchema,
]);

export type StoryMark = z.infer<typeof markSchema>;

function markKind(mark: StoryMark): "bold" | "italic" | "link" {
  return typeof mark === "string" ? mark : mark.type;
}

function noDuplicateMarkKinds(marks: StoryMark[] | undefined): boolean {
  if (!marks || marks.length === 0) return true;
  const kinds = marks.map(markKind);
  return new Set(kinds).size === kinds.length;
}

function textRunSchema(maxTextLength: number) {
  return z
    .object({
      text: z.string().trim().min(1).max(maxTextLength),
      marks: z.array(markSchema).max(MAX_MARKS_PER_RUN).optional(),
    })
    .refine((run) => noDuplicateMarkKinds(run.marks), {
      message: "A run cannot repeat the same mark twice.",
      path: ["marks"],
    });
}

export type StoryTextRun = z.infer<ReturnType<typeof textRunSchema>>;

function runsLength(runs: StoryTextRun[]): number {
  return runs.reduce((sum, run) => sum + run.text.length, 0);
}

function runsSchema(maxTotalLength: number, minRuns = 1) {
  return z
    .array(textRunSchema(maxTotalLength))
    .min(minRuns)
    .max(MAX_RUNS_PER_BLOCK)
    .refine((runs) => runsLength(runs) <= maxTotalLength, {
      message: `Text is too long (max ${maxTotalLength} characters).`,
    });
}

const paragraphBlockSchema = z.object({
  type: z.literal("paragraph"),
  text: runsSchema(5000),
});

const headingBlockSchema = z.object({
  type: z.literal("heading"),
  level: z.union([z.literal(2), z.literal(3)]),
  text: runsSchema(200),
});

const quoteBlockSchema = z.object({
  type: z.literal("quote"),
  text: runsSchema(2000),
});

const listBlockSchema = z.object({
  type: z.literal("list"),
  style: z.enum(["ordered", "unordered"]),
  items: z.array(runsSchema(1000)).min(1).max(50),
});

export const storyContentBlockSchema = z.discriminatedUnion("type", [
  paragraphBlockSchema,
  headingBlockSchema,
  quoteBlockSchema,
  listBlockSchema,
]);

export type StoryContentBlock = z.infer<typeof storyContentBlockSchema>;

function blockCharacterCount(block: StoryContentBlock): number {
  if (block.type === "list") {
    return block.items.reduce((sum, item) => sum + runsLength(item), 0);
  }
  return runsLength(block.text);
}

export const storyContentSchema = z
  .array(storyContentBlockSchema)
  .min(1, "Your story needs at least some content.")
  .max(200)
  .refine(
    (blocks) =>
      blocks.reduce((sum, block) => sum + blockCharacterCount(block), 0) <=
      MAX_DOCUMENT_CHARACTERS,
    {
      message: `Story content is too long (max ${MAX_DOCUMENT_CHARACTERS} characters).`,
    },
  );

// Mirrors supabase/migrations/20260803090200_story_revisions.sql's CHECK
// constraints — duplicated deliberately for fast/friendly form errors; the
// DB constraints (and the immutability trigger) are the non-bypassable
// source of truth per Engineering Rule 3.
export const travelStyles = ["budget", "mid_range", "comfort"] as const;

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
