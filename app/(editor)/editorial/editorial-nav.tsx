import { StaffNav } from "@/components/staff-nav";
import {
  getCurrentUserAvatarEmoji,
  getCurrentUserRole,
} from "@/lib/auth/roles";

const editorialNav = [
  { href: "/editorial", label: "Dashboard" },
  { href: "/editorial/new", label: "New Import" },
  { href: "/editorial/contributors", label: "Contributors" },
  { href: "/readiness", label: "Readiness" },
];

/**
 * Rendered only inside app/(editor)/editorial/layout.tsx, after the real
 * editor/admin role check passes -- same "own nav, no contradictions"
 * reasoning as components/contributor-nav.tsx. The header markup itself
 * (profile icon included) is components/staff-nav.tsx, shared with the
 * moderation, admin and readiness dashboards.
 */
export async function EditorialNav() {
  const [avatarEmoji, role] = await Promise.all([
    getCurrentUserAvatarEmoji(),
    getCurrentUserRole(),
  ]);

  return (
    <StaffNav
      title="Kakinotes — Editorial"
      label="Editorial"
      links={editorialNav}
      avatarEmoji={avatarEmoji}
      role={role}
    />
  );
}
