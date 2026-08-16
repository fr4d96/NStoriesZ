"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * "My Stories" / "New Story" as always-visible, clickable header links,
 * with the current page underlined (`.journiq-nav-link[aria-current="page"]`,
 * app/globals.css) -- a contributor's two most frequent destinations, one
 * click deep instead of two, while they are actually working on stories.
 *
 * Deliberately rendered ONLY by ContributorNav (the `(contributor)` routes:
 * /account, /my-stories, /stories/new, /stories/[id]/edit|preview) and NOT
 * by the public SiteHeader. On public pages a signed-in visitor is reading,
 * not authoring, so those two links stay tucked inside the profile icon's
 * dropdown (UserAvatarMenu's own menuItems, which carry them on every
 * signed-in header in the app) rather than taking permanent space in the
 * public nav bar next to Stories/Destinations/About. UserAvatarMenu also
 * still owns Account/Sign out everywhere.
 *
 * Client Component (needs usePathname for the active-page match) rendered
 * inside the otherwise-Server-Component ContributorNav, the same split
 * ThemeToggle/UserAvatarMenu already use in that header.
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
