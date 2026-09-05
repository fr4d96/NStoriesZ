import { StaffNav } from "@/components/staff-nav";
import {
  getCurrentUserAvatarEmoji,
  getCurrentUserRole,
} from "@/lib/auth/roles";

const moderationNav = [
  { href: "/moderation", label: "Overview" },
  { href: "/moderation/stories", label: "Stories queue" },
  { href: "/moderation/reports", label: "Reports" },
  { href: "/moderation/takedowns", label: "Takedowns" },
  { href: "/readiness", label: "Readiness" },
];

/**
 * Rendered only inside app/(moderation)/moderation/layout.tsx, after the
 * real moderator/admin role check passes -- same "own nav, no
 * contradictions" reasoning as app/(editor)/editorial/editorial-nav.tsx.
 * The header markup itself (including the profile icon every signed-in
 * header renders, and the mobile row order) lives in components/staff-nav.tsx,
 * shared with the editorial, admin and readiness dashboards.
 */
export async function ModerationNav() {
  const [avatarEmoji, role] = await Promise.all([
    getCurrentUserAvatarEmoji(),
    getCurrentUserRole(),
  ]);

  return (
    <StaffNav
      title="Kakinotes — Moderation"
      label="Moderation"
      links={moderationNav}
      avatarEmoji={avatarEmoji}
      role={role}
    />
  );
}
