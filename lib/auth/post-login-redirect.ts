import type { AppRole } from "@/lib/auth/staff-guard";

/**
 * Where a signed-in user lands when nothing more specific was requested
 * (e.g. they navigated straight to /sign-in, rather than being bounced
 * here from a protected page with a real `?next=`). Staff roles land on
 * their own dashboard instead of the ordinary contributor pages --
 * `/admin` has no real dashboard yet (see app/(admin)/admin/route.ts), so
 * admin falls back to /moderation, the broadest staff surface an admin
 * already has access to (resolveStaffAccess allows admin on both
 * /moderation and /editorial). An ordinary user (or a signed-in caller
 * whose role lookup came back null) lands on My Stories, not the account
 * settings page.
 */
export function defaultPathForRole(role: AppRole | null): string {
  switch (role) {
    case "admin":
      return "/moderation";
    case "moderator":
      return "/moderation";
    case "editor":
      return "/editorial";
    default:
      return "/my-stories";
  }
}
