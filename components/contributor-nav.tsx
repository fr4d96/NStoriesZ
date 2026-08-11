"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { MobileNavToggle } from "@/components/mobile-nav-toggle";
import { ThemeToggle } from "@/components/theme-toggle";

const contributorNav = [
  { href: "/my-stories", label: "My Stories" },
  { href: "/stories/new", label: "New Story" },
  { href: "/account", label: "Account" },
];

/**
 * Rendered only inside the (contributor) layout, after the real session
 * check passes — deliberately separate from the public SiteHeader (never a
 * contradictory "Sign in" link for a signed-in user), but styled to match
 * it: same solid-header treatment, logo mark, and underline-on-hover nav
 * links (see app/globals.css .journiq-header-solid/.journiq-nav-link),
 * since this is the same site, just past the sign-in wall.
 */
export function ContributorNav() {
  const pathname = usePathname();

  return (
    <header className="journiq-header-solid sticky top-0 z-40 border-b border-border-subtle text-foreground">
      <div className="mx-auto flex min-h-[76px] max-w-[1160px] items-center gap-5 px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2.5 text-xl font-black tracking-tight"
        >
          <BrandLogo className="border border-current" />
          Kakinotes
        </Link>

        <nav
          aria-label="Contributor"
          className="ml-auto hidden items-center gap-6 text-sm font-bold md:flex"
        >
          {contributorNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={pathname === item.href ? "page" : undefined}
              className={`journiq-nav-link ${
                pathname === item.href ? "text-accent" : ""
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <ThemeToggle />
        </div>

        <div className="ml-auto flex items-center gap-2 md:hidden">
          <ThemeToggle />
          <MobileNavToggle navItems={contributorNav} />
        </div>
      </div>
    </header>
  );
}
