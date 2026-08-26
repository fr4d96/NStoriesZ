"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserRole, resolveStaffAccess } from "@/lib/auth/roles";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { setUserRoleSchema } from "@/lib/validation/admin";
import { setUserRole } from "@/lib/admin/user-accounts";
import { isLastAdminError, ROLE_LABELS } from "@/lib/admin/role-changes";
import { logStaffAction } from "@/lib/log";
import { getErrorMessage } from "@/lib/errors";

export type SetUserRoleActionState = { error?: string; success?: string };

/**
 * Independently re-checks admin here, same convention as every other staff
 * Server Action in this app. admin_set_user_role() re-derives the caller's
 * admin status from the database too (and is the actual authority on the
 * self-demotion and last-admin rules); this is defense in depth, not the
 * enforcement point.
 */
async function requireAdmin(): Promise<string | null> {
  const role = await getCurrentUserRole();
  const access = resolveStaffAccess(role, ["admin"]);
  return access.ok ? null : "Only an admin can change user roles.";
}

export async function setUserRoleAction(
  _prevState: SetUserRoleActionState,
  formData: FormData,
): Promise<SetUserRoleActionState> {
  const authError = await requireAdmin();
  if (authError) return { error: authError };

  const parsed = setUserRoleSchema.safeParse({
    userId: formData.get("userId"),
    role: formData.get("role"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const actorId = (await getCurrentUser())?.id ?? null;

  try {
    await setUserRole(parsed.data);
  } catch (error) {
    logStaffAction({
      actor: actorId,
      // Never the target's email -- only their user id, per lib/log.ts's
      // hard rule. The list this action is reached from renders emails,
      // but nothing here writes one to a log line.
      action: "admin.set_user_role",
      target: parsed.data.userId,
      outcome: "error",
    });
    if (isLastAdminError(error)) {
      return {
        error:
          "Cannot remove the last admin — promote another admin first, then try again.",
      };
    }
    return { error: getErrorMessage(error, "Could not change this role.") };
  }

  logStaffAction({
    actor: actorId,
    action: "admin.set_user_role",
    target: parsed.data.userId,
    outcome: "success",
    detail: parsed.data.role,
  });

  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${parsed.data.userId}`);
  return { success: `Role changed to ${ROLE_LABELS[parsed.data.role]}.` };
}
