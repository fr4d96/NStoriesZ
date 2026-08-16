import Link from "next/link";
import { UserAvatarMenu } from "@/components/auth/user-avatar-menu";
import { getCurrentUserAvatarEmoji } from "@/lib/auth/roles";

const moderationNav = [
  { href: "/moderation", label: "Overview" },
  { href: "/moderation/stories", label: "Stories queue" },
  { href: "/moderation/reports", label: "Reports" },
  { href: "/readiness", label: "Readiness" },
];

/**
 * Rendered only inside app/(moderation)/moderation/layout.tsx, after the
 * real moderator/admin role check passes -- same "own nav, no
 * contradictions" reasoning as app/(editor)/editorial/editorial-nav.tsx.
 * The profile icon (UserAvatarMenu) is the same one every other signed-in
 * header renders -- staff dashboards previously had no way to reach My
 * Stories/Account/Sign out at all.
 */
export async function ModerationNav() {
  const avatarEmoji = await getCurrentUserAvatarEmoji();

  return (
    <header className="border-b border-border-subtle">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Kakinotes — Moderation
        </Link>
        <div className="flex items-center gap-6">
          <nav
            aria-label="Moderation"
            className="flex items-center gap-6 text-sm"
          >
            {moderationNav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="hover:underline"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <UserAvatarMenu emoji={avatarEmoji} />
        </div>
      </div>
    </header>
  );
}
