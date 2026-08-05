"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserRole, resolveStaffAccess } from "@/lib/auth/roles";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { recordLaunchVerificationSchema } from "@/lib/validation/readiness";
import { recordStoryLaunchVerification } from "@/lib/story/readiness";
import { logStaffAction } from "@/lib/log";

export type VerificationActionState = { error?: string; success?: string };

/**
 * Independently re-checks editor/moderator/admin here -- Server Actions are
 * reachable regardless of which page rendered them, so the (readiness)
 * route group's layout guard alone is never sufficient (same hard
 * constraint every other staff Server Action file in this codebase
 * documents). record_story_launch_verification() itself re-checks role and
 * "story is actually published" server-side too; this is defense in depth,
 * not a substitute (Engineering Rule 3).
 */
export async function recordLaunchVerificationAction(
  _prevState: VerificationActionState,
  formData: FormData,
): Promise<VerificationActionState> {
  const access = resolveStaffAccess(await getCurrentUserRole(), [
    "editor",
    "moderator",
    "admin",
  ]);
  if (!access.ok) {
    return { error: "You are not authorized to do that." };
  }

  const parsed = recordLaunchVerificationSchema.safeParse({
    storyId: formData.get("storyId"),
    desktopChecked: formData.get("desktopChecked") === "on",
    mobileChecked: formData.get("mobileChecked") === "on",
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.message ??
        "Check at least one of desktop or mobile.",
    };
  }

  const user = await getCurrentUser();
  try {
    await recordStoryLaunchVerification({
      storyId: parsed.data.storyId,
      desktopChecked: parsed.data.desktopChecked,
      mobileChecked: parsed.data.mobileChecked,
      note: parsed.data.note || undefined,
    });
    logStaffAction({
      actor: user?.id ?? null,
      action: "readiness.record_launch_verification",
      target: parsed.data.storyId,
      outcome: "success",
    });
  } catch (error) {
    logStaffAction({
      actor: user?.id ?? null,
      action: "readiness.record_launch_verification",
      target: parsed.data.storyId,
      outcome: "error",
      detail: error instanceof Error ? error.message : "unknown error",
    });
    return {
      error:
        error instanceof Error
          ? error.message
          : "Could not record verification.",
    };
  }

  revalidatePath("/readiness");
  return { success: "Verification recorded." };
}
