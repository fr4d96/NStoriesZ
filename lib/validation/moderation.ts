import { z } from "zod";

// Staff moderation/editorial-queue search-parameter validation. Mirrors
// lib/validation/discovery.ts's "every field parses independently, a bad
// value for one field is silently dropped rather than failing the whole
// page" convention -- a malformed/tampered query string on a staff page
// should never be a 500, and should never block the rest of the filters
// from applying.

const moderationQueueFieldSchemas = {
  status: z.enum(["submitted", "recently_reviewed"]),
  // "self_submitted", NOT "self_service": this value is compared directly
  // against stories.source_kind::text inside get_moderation_queue(), and
  // the enum's label is `self_submitted` (story_source_kind). The old
  // "self_service" spelling matched no row at all, so choosing "Self-service"
  // in the queue filter silently emptied the queue instead of filtering it.
  // An old bookmarked ?sourceKind=self_service now fails this parse and is
  // dropped (falling back to "any source"), which is the parser's documented
  // behaviour for an unrecognised value -- and strictly better than the
  // zero-results it used to produce.
  sourceKind: z.enum(["self_submitted", "editorial_import"]),
  regionId: z.uuid(),
  consentMethod: z.enum([
    "account",
    "email",
    "written_message",
    "in_person",
    "other",
  ]),
  dateFrom: z.iso.date(),
  dateTo: z.iso.date(),
  page: z.coerce.number().int().min(1),
};

export type ModerationQueueSearchFilters = {
  status?: "submitted" | "recently_reviewed";
  sourceKind?: string;
  regionId?: string;
  consentMethod?: string;
  dateFrom?: string;
  dateTo?: string;
  page: number;
};

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export const MODERATION_QUEUE_PAGE_SIZE = 20;

/** Never throws -- see module doc comment above. */
export function parseModerationQueueSearchParams(
  searchParams: Record<string, string | string[] | undefined>,
): ModerationQueueSearchFilters {
  const result: ModerationQueueSearchFilters = { page: 1 };
  for (const key of Object.keys(
    moderationQueueFieldSchemas,
  ) as (keyof typeof moderationQueueFieldSchemas)[]) {
    const raw = firstValue(searchParams[key]);
    if (raw === undefined) continue;
    const parsed = moderationQueueFieldSchemas[key].safeParse(raw);
    if (!parsed.success) continue;
    if (key === "page") {
      result.page = parsed.data as number;
    } else if (key === "status") {
      result.status = parsed.data as "submitted" | "recently_reviewed";
    } else {
      (result as unknown as Record<string, string>)[key] =
        parsed.data as string;
    }
  }
  return result;
}

const editorialQueueFieldSchemas = {
  status: z.enum([
    "draft",
    "awaiting_contributor_approval",
    "pending_review",
    "changes_requested",
    "published",
    "rejected",
    "archived",
  ]),
  search: z.string().trim().min(1).max(200),
  page: z.coerce.number().int().min(1),
};

export type EditorialQueueSearchFilters = {
  status?: string;
  search?: string;
  page: number;
};

export const EDITORIAL_QUEUE_PAGE_SIZE = 20;

/** Never throws -- same convention as parseModerationQueueSearchParams. */
export function parseEditorialQueueSearchParams(
  searchParams: Record<string, string | string[] | undefined>,
): EditorialQueueSearchFilters {
  const result: EditorialQueueSearchFilters = { page: 1 };
  for (const key of Object.keys(
    editorialQueueFieldSchemas,
  ) as (keyof typeof editorialQueueFieldSchemas)[]) {
    const raw = firstValue(searchParams[key]);
    if (raw === undefined) continue;
    const parsed = editorialQueueFieldSchemas[key].safeParse(raw);
    if (!parsed.success) continue;
    if (key === "page") {
      result.page = parsed.data as number;
    } else {
      (result as unknown as Record<string, string>)[key] =
        parsed.data as string;
    }
  }
  return result;
}

// Stage 3: reports-triage queue. Same "every field parses independently,
// never throws" convention as the two queue parsers above.
const reportsQueueFieldSchemas = {
  status: z.enum(["open", "reviewing", "resolved", "dismissed"]),
  category: z.enum([
    "misinformation",
    "unsafe_employment_advice",
    "harassment",
    "copyright_privacy",
    "spam_commercial",
    "other",
  ]),
  dateFrom: z.iso.date(),
  dateTo: z.iso.date(),
  page: z.coerce.number().int().min(1),
};

export type ReportsQueueSearchFilters = {
  status?: string;
  category?: string;
  dateFrom?: string;
  dateTo?: string;
  page: number;
};

export const REPORTS_QUEUE_PAGE_SIZE = 20;

/** Never throws -- same convention as parseModerationQueueSearchParams. */
export function parseReportsQueueSearchParams(
  searchParams: Record<string, string | string[] | undefined>,
): ReportsQueueSearchFilters {
  const result: ReportsQueueSearchFilters = { page: 1 };
  for (const key of Object.keys(
    reportsQueueFieldSchemas,
  ) as (keyof typeof reportsQueueFieldSchemas)[]) {
    const raw = firstValue(searchParams[key]);
    if (raw === undefined) continue;
    const parsed = reportsQueueFieldSchemas[key].safeParse(raw);
    if (!parsed.success) continue;
    if (key === "page") {
      result.page = parsed.data as number;
    } else {
      (result as unknown as Record<string, string>)[key] =
        parsed.data as string;
    }
  }
  return result;
}

// --- Server Action input schemas ------------------------------------------
//
// `expectedVersion` is `.positive()`, not merely `.int()`. Every caller builds
// it as `Number(formData.get("expectedVersion"))`, and Number(null) is 0 -- so
// a form that simply omitted the field used to sail through validation and
// only fail later, at the RPC's optimistic-concurrency check, as a confusing
// "stale version" error. stories.version is `not null default 1`
// (20260803090100_stories.sql), so a real version is always >= 1 and zero or
// negative can only ever mean a malformed request. Reject it at the trust
// boundary instead (Engineering Rule 2). NaN was already rejected: Zod's
// number type refuses it by default.

export const moderateDecisionSchema = z.object({
  revisionId: z.uuid(),
  expectedVersion: z.number().int().positive(),
  decision: z.enum(["reject", "changes_requested"]),
  userFacingReason: z
    .string()
    .trim()
    .min(1, "A reason is required.")
    .max(2000, "Reason is too long."),
  editorNote: z.string().trim().max(2000).optional().or(z.literal("")),
});

export type ModerateDecisionInput = z.infer<typeof moderateDecisionSchema>;

export const approveStorySchema = z.object({
  revisionId: z.uuid(),
  storyId: z.uuid(),
  userFacingReason: z.string().trim().max(2000).optional().or(z.literal("")),
  editorNote: z.string().trim().max(2000).optional().or(z.literal("")),
});

export type ApproveStoryInput = z.infer<typeof approveStorySchema>;

export const archiveStorySchema = z.object({
  storyId: z.uuid(),
  // A revision belonging to this story, used only to re-derive the story's
  // slug server-side (via getStoryForModerator) for cache invalidation --
  // never trust a client-supplied slug directly (Engineering Rule 2).
  revisionId: z.uuid(),
  expectedVersion: z.number().int().positive(),
  reason: z
    .string()
    .trim()
    .min(1, "A reason is required to archive a story.")
    .max(2000, "Reason is too long."),
  note: z.string().trim().max(2000).optional().or(z.literal("")),
});

export type ArchiveStoryInput = z.infer<typeof archiveStorySchema>;

export const reassignEditorialStorySchema = z.object({
  storyId: z.uuid(),
  editorId: z.uuid(),
  expectedVersion: z.number().int().positive(),
  note: z.string().trim().max(2000).optional().or(z.literal("")),
});

export type ReassignEditorialStoryInput = z.infer<
  typeof reassignEditorialStorySchema
>;

export const resolveReportSchema = z.object({
  reportId: z.uuid(),
  status: z.enum(["reviewing", "resolved", "dismissed"]),
  internalNote: z.string().trim().max(2000).optional().or(z.literal("")),
});

export type ResolveReportInput = z.infer<typeof resolveReportSchema>;

// Mirrors story_reports_category_check -- the four "serious" categories
// resolve_report() requires a non-empty internal note for when closing
// (resolved/dismissed, never reviewing). Duplicated here for a fast/
// friendly client-side check; the DB constraint is the non-bypassable
// source of truth per Engineering Rule 3.
export const SERIOUS_REPORT_CATEGORIES = [
  "misinformation",
  "unsafe_employment_advice",
  "harassment",
  "copyright_privacy",
] as const;

/**
 * Pure client-side mirror of resolve_report()'s own note requirement
 * (supabase/migrations/20260805100700_story_report_notes_and_resolve_report.sql):
 * a non-empty internal note is required only when CLOSING (resolved/
 * dismissed, never reviewing) a report in one of the four serious
 * categories. This is a fast/friendly UI check only -- the DB function is
 * the actual non-bypassable source of truth (Engineering Rule 3), and
 * still rejects a missing note server-side even if this check is somehow
 * bypassed (a hand-crafted request, a stale client, etc).
 */
export function reportNoteRequired(
  category: string,
  status: "reviewing" | "resolved" | "dismissed",
): boolean {
  return (
    (status === "resolved" || status === "dismissed") &&
    (SERIOUS_REPORT_CATEGORIES as readonly string[]).includes(category)
  );
}
