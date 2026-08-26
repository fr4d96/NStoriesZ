import Link from "next/link";
import { UserAvatarMenu } from "@/components/auth/user-avatar-menu";
import {
  getCurrentUserAvatarEmoji,
  getCurrentUserRole,
} from "@/lib/auth/roles";

/**
 * Rendered only inside app/(admin)/admin/layout.tsx, after the real admin
 * role check passes -- same "own nav, no contradictions" reasoning as
 * ModerationNav/EditorialNav. "Overview" arrived with Phase 2: until the
 * dashboard existed, /admin was a stub Route Handler and linking to it
 * would have pointed at raw JSON.
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
    <header className="border-b border-border-subtle">
      {/* Wraps to a second row below `sm` rather than pushing the avatar
          off-screen -- same fix ModerationNav carries. */}
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-4 sm:flex-nowrap sm:px-6">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Kakinotes — Admin
        </Link>
        <div className="flex min-w-0 flex-1 items-center justify-between gap-4 sm:flex-none sm:justify-end sm:gap-6">
          <nav
            aria-label="Admin"
            className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-sm sm:flex-nowrap sm:gap-6"
          >
            {adminNav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="hover:underline"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <UserAvatarMenu emoji={avatarEmoji} role={role} />
        </div>
      </div>
    </header>
  );
}
