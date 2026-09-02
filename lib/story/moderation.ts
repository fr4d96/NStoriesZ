import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import type { Database } from "@/types/database";

type StoryReportRow = Database["public"]["Tables"]["story_reports"]["Row"];

async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new Error("You must be signed in.");
  return user;
}

export async function listAssignedEditorialStories() {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_assigned_editorial_stories");
  if (error) throw error;
  return data ?? [];
}

export type EditorialQueueParams = {
  status?: string;
  search?: string;
  limit?: number;
  offset?: number;
};

export type EditorialQueueRow = {
  story_id: string;
  slug: string;
  title: string | null;
  lifecycle_status: string;
  version: number;
  assigned_editor_id: string | null;
  contributor_id: string;
  created_at: string;
  updated_at: string;
  total_count: number;
};

/**
 * supabase/migrations/20260805101200_editorial_queue.sql#list_editorial_queue() --
 * does not replace listAssignedEditorialStories() above, which the existing
 * /editorial dashboard still calls directly.
 */
export async function listEditorialQueue(
  params: EditorialQueueParams = {},
): Promise<EditorialQueueRow[]> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_editorial_queue", {
    p_status: params.status,
    p_search: params.search,
    p_limit: params.limit,
    p_offset: params.offset,
  });
  if (error) throw error;
  return data ?? [];
}

export async function getStoryForEditor(storyId: string) {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_story_for_editor", {
    p_story_id: storyId,
  });
  if (error) throw error;
  return data ?? [];
}

export type ModeratorStoryDetail = {
  story_id: string;
  slug: string;
  story_version: number;
  lifecycle_status: string;
  source_kind: string;
  submitted_at: string | null;
  revision_id: string;
  revision_number: number;
  revision_status: string;
  revision_updated_at: string;
  title: string;
  excerpt: string | null;
  content_json: unknown;
  contributor_note: string | null;
  trip_start_date: string | null;
  trip_end_date: string | null;
  trip_year: number | null;
  travel_style: string | null;
  total_expense_nzd_cents: number | null;
  contributor_display_name: string | null;
  contributor_public_slug: string | null;
  consent_valid: boolean;
  media_processed: boolean;
  attribution_type: string | null;
  attribution_value: string | null;
  confirmation_method: string | null;
  consent_recorded_at: string | null;
  image_rights_confirmed_at: string | null;
  identifiable_people_state: string | null;
  region_names: string[] | null;
  tag_names: string[] | null;
  media: unknown;
};

export type ModeratorMediaItem = {
  mediaId: string;
  sortOrder: number;
  isCover: boolean;
  altText: string | null;
  caption: string | null;
  decorative: boolean;
  processingState: string;
};

/** Runtime-parses the untyped `media` jsonb column -- never trusts its shape blindly. */
export function parseModeratorMedia(media: unknown): ModeratorMediaItem[] {
  if (!Array.isArray(media)) return [];
  return media.filter(
    (item): item is ModeratorMediaItem =>
      !!item &&
      typeof item === "object" &&
      typeof (item as Record<string, unknown>).mediaId === "string" &&
      typeof (item as Record<string, unknown>).processingState === "string",
  );
}

/**
 * supabase/migrations/20260805100900_moderator_story_detail_functions.sql#get_story_for_moderator() --
 * rebuilt in Stage 1: full publishable content + a consent snapshot
 * (never a live contributors join) + a path-free media list. Moderation
 * history is now a separate call (getStoryModerationHistory()).
 *
 * supabase/migrations/20260805110000_moderator_story_detail_slug_version.sql
 * (Stage 2) added `slug`/`story_version` to this function's return shape --
 * needed by the review page's approve/archive Server Actions (cache
 * invalidation, expectedVersion) with no other moderator-accessible source
 * for either.
 */
export async function getStoryForModerator(
  revisionId: string,
): Promise<ModeratorStoryDetail[]> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_story_for_moderator", {
    p_revision_id: revisionId,
  });
  if (error) throw error;
  return data ?? [];
}

export type ModerationHistoryRow = {
  action_id: string;
  revision_id: string;
  previous_status: string;
  new_status: string;
  user_facing_reason: string | null;
  moderator_id: string | null;
  created_at: string;
  internal_note: string | null;
};

export async function getStoryModerationHistory(
  storyId: string,
): Promise<ModerationHistoryRow[]> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_story_moderation_history", {
    p_story_id: storyId,
  });
  if (error) throw error;
  return data ?? [];
}

export type EditorialHistoryRow = {
  id: string;
  revision_id: string | null;
  editor_id: string | null;
  action_type: string;
  summary: string;
  created_at: string;
};

/**
 * Moderators are allowed to see editorial prep history for review purposes
 * (Engineering Rule 5 governs which TABLE gets written to, not staff read
 * access) -- kept as its own call, never merged into getStoryForEditor().
 */
export async function getStoryEditorialHistory(
  storyId: string,
): Promise<EditorialHistoryRow[]> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_story_editorial_history", {
    p_story_id: storyId,
  });
  if (error) throw error;
  return data ?? [];
}

export type PublishedRevisionSnapshot = {
  revision_id: string;
  title: string;
  excerpt: string | null;
  content_json: unknown;
  trip_start_date: string | null;
  trip_end_date: string | null;
  trip_year: number | null;
  travel_style: string | null;
  total_expense_nzd_cents: number | null;
};

export async function getPublishedRevisionSnapshot(
  storyId: string,
): Promise<PublishedRevisionSnapshot[]> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "get_published_revision_snapshot",
    { p_story_id: storyId },
  );
  if (error) throw error;
  return data ?? [];
}

export type ModerationQueueParams = {
  status?: "submitted" | "recently_reviewed";
  sourceKind?: string;
  regionId?: string;
  consentMethod?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
};

export type ModerationQueueRow = {
  revision_id: string;
  story_id: string;
  slug: string;
  title: string;
  submitted_at: string | null;
  is_replacement: boolean;
  submission_kind: "first" | "replacement" | "resubmission";
  revision_number: number;
  source_kind: string | null;
  contributor_display_name: string | null;
  contributor_public_slug: string | null;
  consent_method: string | null;
  /**
   * Non-whitespace character count of the submitted document, computed in
   * SQL (_content_json_text_length) rather than by shipping content_json --
   * a page of 50 rows must not drag 50 full story documents across the
   * wire to answer "is this one empty". 0 means an empty submission, which
   * is what the queue's "No story content" flag reads.
   */
  content_text_length: number;
  image_count: number;
  location_count: number;
  tag_count: number;
  open_report_count: number;
  /** Non-null only in the `recently_reviewed` branch. */
  decided_at: string | null;
  /** The revision status the decision moved to; `recently_reviewed` only. */
  decision: string | null;
  total_count: number;
};

/**
 * supabase/migrations/20260805100800_get_moderation_queue_v2.sql#get_moderation_queue() --
 * rebuilt this stage with filters/pagination/labels. See that migration's
 * header comment for the exact submission_kind precedence rule.
 */
export async function getModerationQueue(
  params: ModerationQueueParams = {},
): Promise<ModerationQueueRow[]> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_moderation_queue", {
    p_status: params.status,
    p_source_kind: params.sourceKind,
    p_region_id: params.regionId,
    // p_work_type_id still exists on the RPC but is never sent: the queue's
    // work-type filter was removed when work types were retired (2026-08-16).
    p_consent_method: params.consentMethod,
    p_date_from: params.dateFrom,
    p_date_to: params.dateTo,
    p_limit: params.limit,
    p_offset: params.offset,
  });
  if (error) throw error;
  return (data ?? []) as ModerationQueueRow[];
}

/**
 * Only reject/changes_requested remain -- moderate_revision('approve') has
 * raised since Prompt 4 Sub-phase 2 (supabase/migrations/20260804090400_finalize_story_publication.sql),
 * directing callers to beginStoryPublicationAttempt()/finalizeStoryPublication()
 * instead. The 'approve' branch of this wrapper was dead code (it would
 * always throw at the DB layer) -- removed along with the type.
 */
export async function moderateRevision(params: {
  revisionId: string;
  expectedVersion: number;
  decision: "reject" | "changes_requested";
  userFacingReason?: string;
  editorNote?: string;
}) {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("moderate_revision", {
    p_revision_id: params.revisionId,
    p_expected_version: params.expectedVersion,
    p_decision: params.decision,
    p_user_facing_reason: params.userFacingReason,
    p_editor_note: params.editorNote,
  });
  if (error) throw error;
}

/**
 * supabase/migrations/20260804090300_begin_story_publication_attempt.sql --
 * moderator/admin only. Mints a server-generated attempt id for a submitted
 * revision. NOT wired into any UI/orchestration this stage -- Stage 2 owns
 * the media-copy-then-finalize Server Action.
 */
export async function beginStoryPublicationAttempt(
  revisionId: string,
): Promise<string> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "begin_story_publication_attempt",
    {
      p_revision_id: revisionId,
    },
  );
  if (error) throw error;
  return data;
}

/**
 * supabase/migrations/20260804090400_finalize_story_publication.sql --
 * moderator/admin only, the single atomic publication transaction. Assumes
 * the admin-client-driven media copy work has already completed for any
 * not-already-promoted media on the revision (Stage 2's job to orchestrate
 * -- this wrapper is not called from any UI yet).
 */
export async function finalizeStoryPublication(params: {
  revisionId: string;
  approvalAttemptId: string;
  userFacingReason?: string;
  editorNote?: string;
}) {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("finalize_story_publication", {
    p_revision_id: params.revisionId,
    p_approval_attempt_id: params.approvalAttemptId,
    p_user_facing_reason: params.userFacingReason,
    p_editor_note: params.editorNote,
  });
  if (error) throw error;
}

/**
 * supabase/migrations/20260805100500_archive_reason_and_publication_state_audit.sql --
 * p_reason is now required (moderator/admin only, unchanged authorization).
 */
export async function archiveStory(params: {
  storyId: string;
  expectedVersion: number;
  reason: string;
  note?: string;
}) {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("archive_story", {
    p_story_id: params.storyId,
    p_expected_version: params.expectedVersion,
    p_reason: params.reason,
    p_note: params.note,
  });
  if (error) throw error;
}

/**
 * supabase/migrations/20260805100600_reassign_editorial_story.sql --
 * editor/admin only, editorial_import stories only. See that migration's
 * header comment for the exact claim/hand-off authorization rule.
 */
export async function reassignEditorialStory(params: {
  storyId: string;
  editorId: string;
  note?: string;
  expectedVersion: number;
}) {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("reassign_editorial_story", {
    p_story_id: params.storyId,
    p_editor_id: params.editorId,
    p_note: params.note,
    p_expected_version: params.expectedVersion,
  });
  if (error) throw error;
}

export async function listMyReports() {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_my_reports");
  if (error) throw error;
  return data ?? [];
}

export type ReportsForStaffParams = {
  status?: string;
  category?: string;
  dateFrom?: string;
  dateTo?: string;
  storyId?: string;
  limit?: number;
  offset?: number;
};

/**
 * supabase/migrations/20260805101100_list_reports_for_staff_filters.sql --
 * p_story_id lets a story review page reuse this instead of a separate
 * "reports for a story" function.
 */
export async function listReportsForStaff(
  params: ReportsForStaffParams = {},
): Promise<StoryReportRow[]> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_reports_for_staff", {
    p_status: params.status,
    p_category: params.category,
    p_date_from: params.dateFrom,
    p_date_to: params.dateTo,
    p_story_id: params.storyId,
    p_limit: params.limit,
    p_offset: params.offset,
  });
  if (error) throw error;
  return data ?? [];
}

/**
 * supabase/migrations/20260805100700_story_report_notes_and_resolve_report.sql --
 * internalNote is now required when closing (resolved/dismissed) a report
 * in one of the four serious categories (misinformation,
 * unsafe_employment_advice, harassment, copyright_privacy); optional
 * otherwise, and never required for the 'reviewing' transition.
 */
export async function resolveReport(params: {
  reportId: string;
  status: "reviewing" | "resolved" | "dismissed";
  internalNote?: string;
}) {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_report", {
    p_report_id: params.reportId,
    p_status: params.status,
    p_internal_note: params.internalNote,
  });
  if (error) throw error;
}

export type ReportNoteRow = {
  id: string;
  report_id: string;
  internal_note: string;
  created_by: string | null;
  created_at: string;
};

/**
 * supabase/migrations/20260805100700_story_report_notes_and_resolve_report.sql#get_report_notes() --
 * the only reader for story_report_notes besides resolve_report()'s own
 * insert path.
 */
export async function getReportNotes(
  reportId: string,
): Promise<ReportNoteRow[]> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_report_notes", {
    p_report_id: reportId,
  });
  if (error) throw error;
  return data ?? [];
}

export async function logEditorialAction(params: {
  storyId: string;
  revisionId: string;
  actionType: string;
  summary: string;
}) {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("log_editorial_action", {
    p_story_id: params.storyId,
    p_revision_id: params.revisionId,
    p_action_type: params.actionType,
    p_summary: params.summary,
  });
  if (error) throw error;
}
