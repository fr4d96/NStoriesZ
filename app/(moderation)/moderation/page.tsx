import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Moderation",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Minimal landing page per Stage 2's scope -- a full reports-triage page is
 * Stage 3's job (this stage only needs enough to review a story's OWN open
 * reports inline on its review page, via listReportsForStaff({storyId}) --
 * see app/(moderation)/moderation/stories/[id]/page.tsx).
 */
export default function ModerationLandingPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        Moderation
      </h1>
      <ul className="mt-8 space-y-3">
        <li>
          <Link
            href="/moderation/stories"
            className="text-sm font-medium underline underline-offset-2"
          >
            Stories queue
          </Link>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            Submitted revisions awaiting a decision, plus recently reviewed
            ones.
          </p>
        </li>
      </ul>
      <p className="mt-10 text-sm text-black/50 dark:text-white/50">
        A dedicated reports-triage view is planned for a later stage — for now,
        a story&apos;s open reports appear inline on its own review page.
      </p>
    </div>
  );
}
