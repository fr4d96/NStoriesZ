import Link from "next/link";

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
 */
export function ModerationNav() {
  return (
    <header className="border-b border-black/10 dark:border-white/10">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Journiq — Moderation
        </Link>
        <nav
          aria-label="Moderation"
          className="flex items-center gap-6 text-sm"
        >
          {moderationNav.map((item) => (
            <Link key={item.href} href={item.href} className="hover:underline">
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
