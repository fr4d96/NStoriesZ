/**
 * Pure derivations behind the /admin/users role-management UI.
 *
 * Deliberately I/O-free and free of `server-only`, same split as
 * lib/story/moderation-analytics.ts: every rule the UI applies is decided
 * here from values the page already has, so it can be unit-tested directly
 * without a database.
 *
 * Every function in this file is a MIRROR of a guard that
 * admin_set_user_role() already enforces server-side
 * (supabase/migrations/20260802085014_user_roles.sql, extended by
 * 20260823090000_admin_set_user_role_last_admin_guard.sql). Per Engineering
 * Rule 3 the database is the source of truth; this exists only so the UI
 * can explain WHY an option is unavailable rather than letting the admin
 * click into a raw Postgres exception. Nothing here is a substitute for the
 * server-side check, and the action surfaces the DB's own error verbatim
 * when one of these mirrors is somehow bypassed.
 */

import { APP_ROLES, type AppRoleValue } from "@/lib/validation/admin";

export const ROLE_LABELS: Record<AppRoleValue, string> = {
  user: "User",
  editor: "Editor",
  moderator: "Moderator",
  admin: "Admin",
};

export type RoleChangeAvailability =
  { allowed: true } | { allowed: false; reason: string };

/**
 * Whether the viewing admin may move `targetRole` -> `nextRole` for this
 * target account.
 *
 * Two rules, both mirroring the database:
 *  - Self-demotion is refused ("Admins cannot demote themselves through
 *    this function"). Demoting a PEER admin stays allowed -- that is a
 *    deliberate product decision, not an oversight.
 *  - A demotion that would leave zero admins is refused. `adminCount` is
 *    the total number of admin accounts, read from
 *    list_user_accounts(role: "admin").total_count -- never counted from
 *    the current page, which is only ever a slice.
 */
export function resolveRoleChangeAvailability(params: {
  viewerUserId: string;
  targetUserId: string;
  targetRole: AppRoleValue | null;
  nextRole: AppRoleValue;
  adminCount: number;
}): RoleChangeAvailability {
  const { viewerUserId, targetUserId, targetRole, nextRole, adminCount } =
    params;

  if (targetRole === nextRole) {
    return { allowed: false, reason: "Already this role." };
  }

  if (targetUserId === viewerUserId && nextRole !== "admin") {
    return {
      allowed: false,
      reason: "You cannot demote your own admin account.",
    };
  }

  if (targetRole === "admin" && nextRole !== "admin" && adminCount <= 1) {
    return {
      allowed: false,
      reason: "This is the last admin — promote another admin first.",
    };
  }

  return { allowed: true };
}

export type RoleOption = {
  role: AppRoleValue;
  label: string;
  availability: RoleChangeAvailability;
};

/** Every role, in a fixed order, each annotated with whether it's offerable. */
export function buildRoleOptions(params: {
  viewerUserId: string;
  targetUserId: string;
  targetRole: AppRoleValue | null;
  adminCount: number;
}): RoleOption[] {
  return APP_ROLES.map((role) => ({
    role,
    label: ROLE_LABELS[role],
    availability: resolveRoleChangeAvailability({ ...params, nextRole: role }),
  }));
}

/**
 * SQLSTATE 'WHV02', raised by admin_set_user_role() when a write would
 * leave zero admins. Same mechanism as lib/story/rpc-errors.ts's
 * isTermsChangedError ('WHV01') -- PostgREST surfaces a Postgres error's
 * SQLSTATE as `.code` on the returned error object.
 *
 * This branch is reachable even when buildRoleOptions() offered the change:
 * the guard's real job is the concurrent case (two admins demoting each
 * other at the same moment), where both callers read a healthy admin count
 * before either write commits.
 */
export function isLastAdminError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "WHV02"
  );
}

/** "Never" for an account that has not signed in yet, otherwise a date. */
export function formatSignIn(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString("en-NZ");
}

export type ActivityEntry = {
  kind: string;
  story_id: string;
  story_slug: string | null;
  label: string;
  created_at: string;
};

/**
 * get_user_account_detail() returns recent_activity as jsonb. It is always
 * an array (the function coalesces to '[]'), but this is the app's trust
 * boundary for a jsonb column, so the shape is checked rather than cast --
 * anything unrecognised is dropped instead of rendering `undefined` into
 * the page.
 */
export function parseActivity(value: unknown): ActivityEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is ActivityEntry => {
    if (typeof entry !== "object" || entry === null) return false;
    const row = entry as Record<string, unknown>;
    return (
      typeof row.kind === "string" &&
      typeof row.story_id === "string" &&
      typeof row.label === "string" &&
      typeof row.created_at === "string"
    );
  });
}
