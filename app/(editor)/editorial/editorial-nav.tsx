import Link from "next/link";
import { UserAvatarMenu } from "@/components/auth/user-avatar-menu";
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
 * reasoning as components/contributor-nav.tsx. The profile icon
 * (UserAvatarMenu) is the same one every other signed-in header renders.
 */
export async function EditorialNav() {
  const [avatarEmoji, role] = await Promise.all([
    getCurrentUserAvatarEmoji(),
    getCurrentUserRole(),
  ]);

  return (
    <header className="border-b border-border-subtle">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Kakinotes — Editorial
        </Link>
        <div className="flex items-center gap-6">
          <nav
            aria-label="Editorial"
            className="flex items-center gap-6 text-sm"
          >
            {editorialNav.map((item) => (
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
