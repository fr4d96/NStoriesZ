import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import type {
  RevisionInput,
  SubmitRevisionInput,
} from "@/lib/validation/story";

// Thin wrappers over the SECURITY DEFINER RPCs — no direct table access
// exists for any of this. Every function derives the caller from the
// session (never a userId parameter); the RPC itself re-derives auth.uid()
// server-side regardless, this is just a clean "you must be signed in"
// error instead of a raw Postgres one.

async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new Error("You must be signed in.");
  return user;
}

function revisionArgs(input: RevisionInput) {
  return {
    p_title: input.title,
    p_excerpt: input.excerpt || undefined,
    p_content_json: input.contentJson,
    p_trip_start_date: input.tripStartDate || undefined,
    p_trip_end_date: input.tripEndDate || undefined,
    p_trip_year: input.tripYear,
    p_travel_style: input.travelStyle,
    p_total_expense_nzd_cents: input.totalExpenseNzdCents,
    p_contributor_note: input.contributorNote || undefined,
  };
}

export async function createSelfServiceDraft(input: RevisionInput) {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "create_self_service_draft",
    revisionArgs(input),
  );
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function createEditorialImportDraft(
  contributorId: string,
  input: RevisionInput,
  assignedEditorId?: string,
) {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_editorial_import_draft", {
    p_contributor_id: contributorId,
    ...revisionArgs(input),
    p_assigned_editor_id: assignedEditorId,
  });
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function markEditorialDraftAwaitingApproval(storyId: string) {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc(
    "mark_editorial_draft_awaiting_approval",
    {
      p_story_id: storyId,
    },
  );
  if (error) throw error;
}

export async function saveRevisionDraft(
  revisionId: string,
  expectedVersion: number,
  input: RevisionInput,
) {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_revision_draft", {
    p_revision_id: revisionId,
    p_expected_version: expectedVersion,
    ...revisionArgs(input),
  });
  if (error) throw error;
}

export async function submitRevisionWithConsent(input: SubmitRevisionInput) {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_revision_with_consent", {
    p_revision_id: input.revisionId,
    p_expected_version: input.expectedVersion,
    p_confirmation_method: input.confirmationMethod,
    p_publication_confirmed: input.publicationConfirmed,
    p_image_rights_confirmed: input.imageRightsConfirmed,
    p_identifiable_people_state: input.identifiablePeopleState,
    p_editorial_assistance_confirmed: input.editorialAssistanceConfirmed,
  });
  if (error) throw error;
}

export async function createNextDraftRevision(storyId: string) {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_next_draft_revision", {
    p_story_id: storyId,
  });
  if (error) throw error;
  return data;
}

export async function withdrawUnstartedSubmission(storyId: string) {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("withdraw_unstarted_submission", {
    p_story_id: storyId,
  });
  if (error) throw error;
}

export async function requestEditorialChanges(storyId: string, note: string) {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_editorial_changes", {
    p_story_id: storyId,
    p_note: note,
  });
  if (error) throw error;
}

export async function declineEditorialPublication(
  storyId: string,
  note: string,
) {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("decline_editorial_publication", {
    p_story_id: storyId,
    p_note: note,
  });
  if (error) throw error;
}

export async function revokePublicationConsent(
  storyId: string,
  expectedVersion: number,
) {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_publication_consent", {
    p_story_id: storyId,
    p_expected_version: expectedVersion,
  });
  if (error) throw error;
}

export async function setRevisionLocations(
  revisionId: string,
  expectedVersion: number,
  locations: Array<{
    regionId: string;
    destinationId?: string;
    sortOrder?: number;
  }>,
) {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_revision_locations", {
    p_revision_id: revisionId,
    p_expected_version: expectedVersion,
    p_locations: locations.map((l) => ({
      region_id: l.regionId,
      destination_id: l.destinationId ?? null,
      sort_order: l.sortOrder ?? 0,
    })),
  });
  if (error) throw error;
}

export async function setRevisionWorkTypes(
  revisionId: string,
  expectedVersion: number,
  workTypeIds: string[],
) {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_revision_work_types", {
    p_revision_id: revisionId,
    p_expected_version: expectedVersion,
    p_work_type_ids: workTypeIds,
  });
  if (error) throw error;
}

export async function setRevisionTags(
  revisionId: string,
  expectedVersion: number,
  tagIds: string[],
) {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_revision_tags", {
    p_revision_id: revisionId,
    p_expected_version: expectedVersion,
    p_tag_ids: tagIds,
  });
  if (error) throw error;
}

export async function attachStoryMedia(params: {
  revisionId: string;
  expectedVersion: number;
  privateStoragePath: string;
  sourceMimeType: string;
  width?: number;
  height?: number;
  sourceFileSizeBytes?: number;
  altText?: string;
  caption?: string;
  decorative?: boolean;
}) {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("attach_story_media", {
    p_revision_id: params.revisionId,
    p_expected_version: params.expectedVersion,
    p_private_storage_path: params.privateStoragePath,
    p_source_mime_type: params.sourceMimeType,
    p_width: params.width,
    p_height: params.height,
    p_source_file_size_bytes: params.sourceFileSizeBytes,
    p_alt_text: params.altText,
    p_caption: params.caption,
    p_decorative: params.decorative ?? false,
  });
  if (error) throw error;
  return data;
}

export async function updateStoryMediaCaption(params: {
  revisionId: string;
  mediaId: string;
  expectedVersion: number;
  altText: string | null;
  caption: string | null;
  decorative: boolean;
}) {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_story_media_caption", {
    p_revision_id: params.revisionId,
    p_media_id: params.mediaId,
    p_expected_version: params.expectedVersion,
    // The generated RPC types mark these as required strings (no SQL DEFAULT
    // was given), but the underlying text parameters happily accept NULL —
    // cast rather than force a non-null placeholder value into the DB.
    p_alt_text: params.altText as string,
    p_caption: params.caption as string,
    p_decorative: params.decorative,
  });
  if (error) throw error;
}

export async function reorderStoryMedia(
  revisionId: string,
  expectedVersion: number,
  mediaOrder: string[],
) {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("reorder_story_media", {
    p_revision_id: revisionId,
    p_expected_version: expectedVersion,
    p_media_order: mediaOrder,
  });
  if (error) throw error;
}

export async function setStoryCoverMedia(
  revisionId: string,
  expectedVersion: number,
  mediaId: string,
) {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_story_cover_media", {
    p_revision_id: revisionId,
    p_expected_version: expectedVersion,
    p_media_id: mediaId,
  });
  if (error) throw error;
}

export async function detachStoryMedia(
  revisionId: string,
  expectedVersion: number,
  mediaId: string,
) {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("detach_story_media", {
    p_revision_id: revisionId,
    p_expected_version: expectedVersion,
    p_media_id: mediaId,
  });
  if (error) throw error;
}

export async function createStoryReport(
  storyId: string,
  category: string,
  details?: string,
) {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_story_report", {
    p_story_id: storyId,
    p_category: category,
    p_details: details,
  });
  if (error) throw error;
  return data;
}
