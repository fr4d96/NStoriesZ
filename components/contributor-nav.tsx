import Link from "next/link";

const contributorNav = [
  { href: "/my-stories", label: "My Stories" },
  { href: "/stories/new", label: "New Story" },
  { href: "/account", label: "Account" },
];

/**
 * Rendered only inside the (contributor) layout, after the real session
 * check passes — deliberately separate from the static public SiteHeader so
 * there's never a contradictory "Sign in" link shown to a signed-in user.
 */
export function ContributorNav() {
  return (
    <header className="border-b border-black/10 dark:border-white/10">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Journiq
        </Link>
        <nav
          aria-label="Contributor"
          className="flex items-center gap-6 text-sm"
        >
          {contributorNav.map((item) => (
            <Link key={item.href} href={item.href} className="hover:underline">
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
