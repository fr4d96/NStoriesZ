import type { AppRole } from "@/lib/auth/staff-guard";

/**
 * The staff links a given role should see in the profile dropdown.
 *
 * PRESENTATION ONLY — this decides what to *draw*, never what someone may
 * *reach*. Engineering Rule 2 still holds in full: the role is re-derived
 * server-side on every request by proxy.ts, again by each route group's
 * layout, and again by RLS underneath. A tampered client that talks itself
 * into rendering an /admin link still gets the same flat 404 as a signed-out
 * visitor. Showing a link is not granting access.
 *
 * Every entry below mirrors proxy.ts's actual gate exactly, so the menu can
 * never offer a link that 404s for the role it was rendered for:
 *
 *   /editorial*   -> editor, admin           (STAFF_EDITORIAL_PATH)
 *   /moderation*  -> moderator, admin        (STAFF_MODERATION_PATH)
 *   /readiness*   -> editor, moderator, admin (STAFF_READINESS_PATH)
 *   /admin*       -> admin                   (STAFF_ADMIN_PATH)
 *
 * Note what that table means for admin: an admin is allowed on /moderation
 * and /editorial too, so their menu is the union, not just the admin pages.
 * A moderator is NOT allowed on /editorial and an editor is NOT allowed on
 * /moderation — neither ever sees the other's link.
 *
 * Kept pure and free of `server-only` so it can be unit-tested directly and
 * used from the client SiteHeader, same split as resolveStaffAccess.
 */
export type StaffMenuItem = { href: string; label: string };

const READINESS: StaffMenuItem = { href: "/readiness", label: "Readiness" };

const STAFF_MENUS: Record<AppRole, StaffMenuItem[]> = {
  admin: [
    { href: "/admin", label: "Admin overview" },
    { href: "/admin/users", label: "Users" },
    { href: "/moderation", label: "Moderation" },
    { href: "/editorial", label: "Editorial" },
    READINESS,
  ],
  moderator: [
    { href: "/moderation", label: "Moderation overview" },
    { href: "/moderation/stories", label: "Stories to review" },
    { href: "/moderation/reports", label: "Reader reports" },
    READINESS,
  ],
  editor: [{ href: "/editorial", label: "Editorial queue" }, READINESS],
  // An ordinary contributor has no staff surface at all. Returning an empty
  // list (rather than omitting the case) is what makes the dropdown render
  // no divider and no empty group for them.
  user: [],
};

export function staffMenuItemsForRole(role: AppRole | null): StaffMenuItem[] {
  if (!role) return [];
  return STAFF_MENUS[role] ?? [];
}
