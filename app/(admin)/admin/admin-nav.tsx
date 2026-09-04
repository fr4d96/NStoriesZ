import { StaffNav } from "@/components/staff-nav";
import {
  getCurrentUserAvatarEmoji,
  getCurrentUserRole,
} from "@/lib/auth/roles";

/**
 * Rendered only inside app/(admin)/admin/layout.tsx, after the real admin
 * role check passes -- same "own nav, no contradictions" reasoning as
 * ModerationNav/EditorialNav. "Overview" arrived with Phase 2: until the
 * dashboard existed, /admin was a stub Route Handler and linking to it
 * would have pointed at raw JSON. The header markup itself is
 * components/staff-nav.tsx, shared across the staff dashboards.
 */
const adminNav = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "Users" },
  { href: "/moderation", label: "Moderation" },
  { href: "/editorial", label: "Editorial" },
  { href: "/readiness", label: "Readiness" },
];

export async function AdminNav() {
  const [avatarEmoji, role] = await Promise.all([
    getCurrentUserAvatarEmoji(),
    getCurrentUserRole(),
  ]);

  return (
    <StaffNav
      title="Kakinotes — Admin"
      label="Admin"
      links={adminNav}
      avatarEmoji={avatarEmoji}
      role={role}
    />
  );
}
