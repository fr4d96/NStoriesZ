import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listReportsForStaff, getReportNotes } from "@/lib/story/moderation";
import { ResolveReportForm } from "./resolve-form";

export const metadata: Metadata = {
  title: "Report Detail",
  robots: { index: false, follow: false },
};

// Staff content, reflects live status/notes -- never cached/pre-rendered.
export const dynamic = "force-dynamic";

const CATEGORY_LABELS: Record<string, string> = {
  misinformation: "Misinformation",
  unsafe_employment_advice: "Unsafe employment advice",
  harassment: "Harassment",
  copyright_privacy: "Copyright / privacy",
  spam_commercial: "Spam / commercial",
  other: "Other",
};

/**
 * `[id]` is the report id. Chosen as an inline single-page detail (not a
 * modal/expand on the queue page) so it has its own bookmarkable URL and
 * its own Server Action target, the same "own page, own actions.ts" shape
 * as app/(moderation)/moderation/stories/[id]/.
 *
 * list_reports_for_staff() has no by-id lookup (its filters are status/
 * category/date-range/story, not report id -- see that migration's own
 * comment) and p_limit is clamped to [1,50] server-side, so an unscoped
 * "fetch everything and find the one with this id" would silently miss any
 * report past the first 50. Instead this page requires a `storyId` query
 * param (populated by the queue page's own link, which already has
 * row.story_id in hand) and re-fetches scoped with p_story_id -- the exact
 * same filter the story review page already uses for a story's own
 * reports. Direct/bookmarked navigation without `storyId` gets a clear
 * "go back to the queue" message rather than an unscoped scan or a silent
 * 404 that looks like the report doesn't exist.
 *
 * getReportNotes()'s result (private internal notes) is read ONLY here,
 * server-side, and rendered only inside this staff-gated route group --
 * grepped the whole repo and confirmed this is the only call site. Never
 * passed through any prop, cache, or response reachable from a
 * reporter/contributor/public surface.
 */
export default async function ReportDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ storyId?: string }>;
}) {
  const { id: reportId } = await params;
  const { storyId } = await searchParams;

  if (!storyId) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 sm:py-16">
        <h1 className="text-2xl font-semibold tracking-tight">Report detail</h1>
        <p className="mt-4 text-sm text-black/70 dark:text-white/70">
          This page needs to be reached from the reports queue, which supplies
          the story context this report belongs to.
        </p>
        <Link
          href="/moderation/reports"
          className="mt-4 inline-block text-sm underline underline-offset-2"
        >
          Back to reports queue
        </Link>
      </div>
    );
  }

  const reports = await listReportsForStaff({ storyId, limit: 50 }).catch(
    () => null,
  );
  const report = reports?.find((r) => r.id === reportId);
  if (!report) notFound();

  const notes = await getReportNotes(reportId).catch(() => []);

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <Link
        href="/moderation/reports"
        className="text-sm underline underline-offset-2"
      >
        ← Back to reports queue
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">
        {CATEGORY_LABELS[report.category] ?? report.category}
      </h1>
      <p className="mt-1 text-sm text-black/60 dark:text-white/60">
        Reported {new Date(report.created_at).toLocaleString("en-NZ")} — status:{" "}
        {report.status}
      </p>

      <div className="mt-4">
        <Link
          href={`/moderation/stories/${report.published_revision_id}`}
          className="text-sm underline underline-offset-2"
        >
          View the reported story
        </Link>
      </div>

      <section className="mt-6 rounded-md border border-black/10 p-4 dark:border-white/10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">
          Reporter details
        </h2>
        <p className="mt-2 text-sm text-black/70 dark:text-white/70">
          {report.details || "No additional details were provided."}
        </p>
      </section>

      {(report.handled_by || report.handled_at) && (
        <section className="mt-6 rounded-md border border-black/10 p-4 dark:border-white/10">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">
            Handled
          </h2>
          <p className="mt-2 text-sm text-black/70 dark:text-white/70">
            {report.handled_at
              ? new Date(report.handled_at).toLocaleString("en-NZ")
              : "—"}
            {report.handled_by ? ` by staff member ${report.handled_by}` : ""}
          </p>
        </section>
      )}

      <section className="mt-6 rounded-md border border-black/10 p-4 dark:border-white/10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">
          Internal notes (staff only — never shown to the reporter)
        </h2>
        {notes.length === 0 ? (
          <p className="mt-2 text-sm text-black/50 dark:text-white/50">
            No internal notes yet.
          </p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {notes.map((n) => (
              <li
                key={n.id}
                className="border-b border-black/5 pb-2 dark:border-white/5"
              >
                <p className="text-black/70 dark:text-white/70">
                  {n.internal_note}
                </p>
                <span className="text-xs text-black/50 dark:text-white/50">
                  {new Date(n.created_at).toLocaleString("en-NZ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6 rounded-md border border-black/10 p-4 dark:border-white/10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">
          Resolution
        </h2>
        <ResolveReportForm
          reportId={report.id}
          category={report.category}
          currentStatus={report.status}
        />
      </section>
    </div>
  );
}
