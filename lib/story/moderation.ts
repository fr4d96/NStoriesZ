import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/get-current-user";

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

export async function getStoryForEditor(storyId: string) {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_story_for_editor", {
    p_story_id: storyId,
  });
  if (error) throw error;
  return data ?? [];
}

export async function getStoryForModerator(revisionId: string) {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_story_for_moderator", {
    p_revision_id: revisionId,
  });
  if (error) throw error;
  return data ?? [];
}

export async function getModerationQueue() {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_moderation_queue");
  if (error) throw error;
  return data ?? [];
}

export async function moderateRevision(params: {
  revisionId: string;
  expectedVersion: number;
  decision: "approve" | "reject" | "changes_requested";
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

export async function archiveStory(storyId: string, expectedVersion: number) {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("archive_story", {
    p_story_id: storyId,
    p_expected_version: expectedVersion,
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

export async function listReportsForStaff(status?: string) {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_reports_for_staff", {
    p_status: status,
  });
  if (error) throw error;
  return data ?? [];
}

export async function resolveReport(
  reportId: string,
  status: "reviewing" | "resolved" | "dismissed",
) {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_report", {
    p_report_id: reportId,
    p_status: status,
  });
  if (error) throw error;
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
