export type AppRole = "user" | "editor" | "moderator" | "admin";

export type StaffAccessDecision = { ok: true; role: AppRole } | { ok: false };

/**
 * Pure decision function, kept separate from lib/auth/roles.ts (which pulls
 * in "server-only") so it can be unit-tested directly — same pattern as
 * resolveContributorAccess. Callers fail closed on `{ ok: false }`
 * regardless of *why* — signed out and signed-in-with-wrong-role both look
 * identical to the outside world, by design (see docs/architecture.md
 * "Staff routes").
 */
export function resolveStaffAccess(
  role: AppRole | null,
  allowedRoles: readonly AppRole[],
): StaffAccessDecision {
  if (!role || !allowedRoles.includes(role)) {
    return { ok: false };
  }

  return { ok: true, role };
}
