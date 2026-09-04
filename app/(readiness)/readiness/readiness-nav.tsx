import { StaffNav } from "@/components/staff-nav";
import {
  getCurrentUserAvatarEmoji,
  getCurrentUserRole,
} from "@/lib/auth/roles";

const readinessNav = [
  { href: "/readiness", label: "Dashboard" },
  { href: "/editorial", label: "Editorial" },
  { href: "/moderation", label: "Moderation" },
];

/**
 * Rendered only inside app/(readiness)/readiness/layout.tsx, after the real
 * editor/moderator/admin role check passes -- same "own nav, no
 * contradictions" reasoning as editorial-nav.tsx/moderation-nav.tsx. The
 * header markup itself (profile icon included) is
 * components/staff-nav.tsx, shared across the staff dashboards.
 *
 * Note this nav links to BOTH /editorial and /moderation, which a plain
 * editor or moderator is not allowed on -- unchanged from before, and
 * harmless: proxy.ts and each layout re-check the role, so the wrong role
 * gets the same flat 404 as anyone else.
 */
export async function ReadinessNav() {
  const [avatarEmoji, role] = await Promise.all([
    getCurrentUserAvatarEmoji(),
    getCurrentUserRole(),
  ]);

  return (
    <StaffNav
      title="Kakinotes — Content Readiness"
      label="Readiness"
      links={readinessNav}
      avatarEmoji={avatarEmoji}
      role={role}
    />
  );
}
