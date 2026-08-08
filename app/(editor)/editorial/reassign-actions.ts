"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserRole, resolveStaffAccess } from "@/lib/auth/roles";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { reassignEditorialStorySchema } from "@/lib/validation/moderation";
import { reassignEditorialStory } from "@/lib/story/moderation";
import { logStaffAction } from "@/lib/log";
import { getErrorMessage } from "@/lib/errors";

export type ReassignActionState = { error?: string; success?: string };

/**
 * Independently re-checks editor/admin here, same hard constraint as every
 * other Server Action in app/(editor)/editorial/ -- reassign_editorial_story()
 * re-checks server-side too (and is the actual authority on the
 * claim/hand-off/admin-any-target rule); this is defense in depth.
 *
 * A non-admin editor's claim/hand-off attempt outside that rule is NOT
 * pre-filtered out of the UI -- reassign_editorial_story() itself rejects
 * it with a clear message, surfaced here verbatim, rather than silently
 * hiding the admin-only case in a confusing way (per the brief).
 */
async function requireEditorOrAdmin(): Promise<string | null> {
  const role = await getCurrentUserRole();
  const access = resolveStaffAccess(role, ["editor", "admin"]);
  return access.ok ? null : "Only an editor or admin can perform this action.";
}

export async function reassignEditorialStoryAction(
  _prevState: ReassignActionState,
  formData: FormData,
): Promise<ReassignActionState> {
  const authError = await requireEditorOrAdmin();
  if (authError) return { error: authError };

  const parsed = reassignEditorialStorySchema.safeParse({
    storyId: formData.get("storyId"),
    editorId: formData.get("editorId"),
    expectedVersion: Number(formData.get("expectedVersion")),
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const actorId = (await getCurrentUser())?.id ?? null;

  try {
    await reassignEditorialStory({
      storyId: parsed.data.storyId,
      editorId: parsed.data.editorId,
      expectedVersion: parsed.data.expectedVersion,
      note: parsed.data.note || undefined,
    });
  } catch (error) {
    logStaffAction({
      actor: actorId,
      action: "editorial.reassign",
      target: parsed.data.storyId,
      outcome: "error",
    });
    return {
      error: getErrorMessage(error, "Could not reassign this story."),
    };
  }

  logStaffAction({
    actor: actorId,
    action: "editorial.reassign",
    target: parsed.data.storyId,
    outcome: "success",
  });
  revalidatePath("/editorial");
  return { success: "Story reassigned." };
}
