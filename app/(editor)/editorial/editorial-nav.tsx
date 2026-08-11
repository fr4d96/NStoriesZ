import Link from "next/link";

const editorialNav = [
  { href: "/editorial", label: "Dashboard" },
  { href: "/editorial/new", label: "New Import" },
  { href: "/editorial/contributors", label: "Contributors" },
  { href: "/readiness", label: "Readiness" },
];

/**
 * Rendered only inside app/(editor)/editorial/layout.tsx, after the real
 * editor/admin role check passes -- same "own nav, no contradictions"
 * reasoning as components/contributor-nav.tsx.
 */
export function EditorialNav() {
  return (
    <header className="border-b border-black/10 dark:border-white/10">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Kakinotes — Editorial
        </Link>
        <nav aria-label="Editorial" className="flex items-center gap-6 text-sm">
          {editorialNav.map((item) => (
            <Link key={item.href} href={item.href} className="hover:underline">
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
