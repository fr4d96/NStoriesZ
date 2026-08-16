"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * "My Stories" / "New Story" as always-visible, clickable header links,
 * with the current page underlined (`.journiq-nav-link[aria-current="page"]`,
 * app/globals.css) -- previously these two were reachable only from inside
 * UserAvatarMenu's dropdown, one click deeper than a contributor's two most
 * frequent destinations should be. UserAvatarMenu still carries them too
 * (harmless duplication, not removed -- the dropdown is also the mobile
 * entry point wherever a header has no room for a second nav row), and
 * still owns Account/Sign out, which aren't frequent-enough actions to
 * deserve permanent header space.
 *
 * Client Component (needs usePathname for the active-page match) rendered
 * inside the otherwise-Server-Component ContributorNav/SiteHeader, the same
 * split ThemeToggle/UserAvatarMenu already use in those headers.
 */
const links = [
  { href: "/my-stories", label: "My Stories" },
  { href: "/stories/new", label: "New Story" },
];

export function ContributorNavLinks({
  className = "",
}: {
  className?: string;
}) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Contributor"
      className={`items-center gap-6 text-sm font-bold ${className}`}
    >
      {links.map((item) => {
        // Exact match only -- /stories/new is its own page, not a prefix of
        // /stories/[id]/edit or /stories/[id]/preview, which are reached
        // FROM it but aren't "New Story" itself once a draft exists.
        const isActive = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className="journiq-nav-link"
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
