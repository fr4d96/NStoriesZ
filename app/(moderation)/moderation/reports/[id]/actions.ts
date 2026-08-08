"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserRole, resolveStaffAccess } from "@/lib/auth/roles";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { resolveReportSchema } from "@/lib/validation/moderation";
import { resolveReport } from "@/lib/story/moderation";
import { logStaffAction } from "@/lib/log";
import { getErrorMessage } from "@/lib/errors";

export type ResolveReportActionState = { error?: string; success?: string };

/**
 * Same shape as app/(moderation)/moderation/stories/[id]/actions.ts:
 * independently re-checks moderator/admin here (Server Actions are
 * reachable regardless of which page rendered them), Zod-validates via
 * resolveReportSchema, then calls resolveReport() -- which itself
 * independently re-derives the caller's role AND is the actual,
 * non-bypassable source of truth for the serious-category note
 * requirement (Engineering Rule 3; resolveReportSchema/
 * SERIOUS_REPORT_CATEGORIES/reportNoteRequired() are only a fast/friendly
 * client-side mirror, see lib/validation/moderation.ts).
 *
 * Never returns or logs the internal note itself -- only a fixed
 * actor/action/target-id/outcome line via logStaffAction(), matching this
 * app's "operational visibility, not a second audit system" logging
 * convention. The note's real destination is story_report_notes, staff-
 * read-only via getReportNotes(), never surfaced to any non-staff path
 * (grepped: the only callers of getReportNotes() anywhere in this repo are
 * this route group's own page.tsx below).
 */
async function requireModeratorOrAdmin(): Promise<string | null> {
  const role = await getCurrentUserRole();
  const access = resolveStaffAccess(role, ["moderator", "admin"]);
  return access.ok
    ? null
    : "Only a moderator or admin can perform this action.";
}

export async function resolveReportAction(
  _prevState: ResolveReportActionState,
  formData: FormData,
): Promise<ResolveReportActionState> {
  const authError = await requireModeratorOrAdmin();
  if (authError) return { error: authError };

  const parsed = resolveReportSchema.safeParse({
    reportId: formData.get("reportId"),
    status: formData.get("status"),
    internalNote: formData.get("internalNote") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const actorId = (await getCurrentUser())?.id ?? null;

  try {
    await resolveReport({
      reportId: parsed.data.reportId,
      status: parsed.data.status,
      internalNote: parsed.data.internalNote || undefined,
    });
  } catch (error) {
    logStaffAction({
      actor: actorId,
      action: "report.resolve",
      target: parsed.data.reportId,
      outcome: "error",
    });
    return {
      error: getErrorMessage(error, "Could not update this report."),
    };
  }

  logStaffAction({
    actor: actorId,
    action: "report.resolve",
    target: parsed.data.reportId,
    outcome: "success",
    detail: parsed.data.status,
  });
  revalidatePath(`/moderation/reports/${parsed.data.reportId}`);
  revalidatePath("/moderation/reports");
  return {
    success:
      parsed.data.status === "reviewing"
        ? "Report marked as under review."
        : parsed.data.status === "resolved"
          ? "Report resolved."
          : "Report dismissed.",
  };
}
