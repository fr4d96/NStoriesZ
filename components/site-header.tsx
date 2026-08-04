import Link from "next/link";
import { MobileNavToggle } from "@/components/mobile-nav-toggle";

const primaryNav = [
  { href: "/", label: "Home" },
  { href: "/stories", label: "Stories" },
  { href: "/contributors", label: "Contributors" },
  { href: "/about", label: "About" },
];

/**
 * Static — never checks auth state, so public pages stay cache-friendly.
 * Always shows "Sign in"; the (contributor) layout renders its own nav for
 * signed-in contributors instead of trying to make this header dynamic.
 */
export function SiteHeader() {
  return (
    <header className="relative border-b border-border-subtle bg-surface">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          WHV Compass NZ
        </Link>

        <nav
          aria-label="Primary"
          className="hidden items-center gap-6 text-sm sm:flex"
        >
          {primaryNav.map((item) => (
            <Link key={item.href} href={item.href} className="hover:underline">
              {item.label}
            </Link>
          ))}
          <Link href="/sign-in" className="hover:underline">
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="rounded-full bg-accent px-3 py-1.5 text-accent-foreground hover:opacity-90"
          >
            Sign up
          </Link>
        </nav>

        <MobileNavToggle
          navItems={[
            ...primaryNav,
            { href: "/sign-in", label: "Sign in" },
            { href: "/sign-up", label: "Sign up" },
          ]}
        />
      </div>
    </header>
  );
}
