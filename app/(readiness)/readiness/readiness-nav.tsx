import Link from "next/link";

/**
 * Rendered only inside app/(readiness)/readiness/layout.tsx, after the real
 * editor/moderator/admin role check passes -- same "own nav, no
 * contradictions" reasoning as editorial-nav.tsx/moderation-nav.tsx.
 */
export function ReadinessNav() {
  return (
    <header className="border-b border-black/10 dark:border-white/10">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Kakinotes — Content Readiness
        </Link>
        <nav aria-label="Readiness" className="flex items-center gap-6 text-sm">
          <Link href="/readiness" className="hover:underline">
            Dashboard
          </Link>
          <Link href="/editorial" className="hover:underline">
            Editorial
          </Link>
          <Link href="/moderation" className="hover:underline">
            Moderation
          </Link>
        </nav>
      </div>
    </header>
  );
}
