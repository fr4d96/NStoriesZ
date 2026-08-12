import type { Metadata } from "next";
import Link from "next/link";
import { listReportsForStaff } from "@/lib/story/moderation";
import {
  parseReportsQueueSearchParams,
  REPORTS_QUEUE_PAGE_SIZE,
} from "@/lib/validation/moderation";

export const metadata: Metadata = {
  title: "Reports Triage",
  robots: { index: false, follow: false },
};

// Staff content -- never cached/pre-rendered, same convention as every
// other page in this route group.
export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

const CATEGORY_LABELS: Record<string, string> = {
  misinformation: "Misinformation",
  unsafe_employment_advice: "Unsafe employment advice",
  harassment: "Harassment",
  copyright_privacy: "Copyright / privacy",
  spam_commercial: "Spam / commercial",
  other: "Other",
};

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  reviewing: "Reviewing",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

function buildHref(
  base: string,
  raw: SearchParams,
  overrides: Record<string, string | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") params.set(key, value);
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) params.delete(key);
    else params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/**
 * Dedicated reports-triage queue -- Stage 2 only ever surfaced a story's
 * OWN open reports inline on its review page (listReportsForStaff({
 * storyId })). This is the first standalone, cross-story view: every
 * filterable report, any status/category/date range, with a link into
 * each report's own detail/resolution page
 * (app/(moderation)/moderation/reports/[id]/page.tsx).
 *
 * Each row links to /moderation/stories/[report.published_revision_id] --
 * NOT a re-derived "current submitted revision" for the story.
 * story_reports.published_revision_id is snapshotted once, at report-
 * creation time (create_story_report() requires the target to be
 * currently public/published, per docs/content-governance.md
 * "Reporting"), and is immutable afterward (the column has an on delete
 * restrict FK, never updated). That is deliberately the right target: a
 * report is about what a reader actually saw and flagged -- the live
 * published content -- not whatever unrelated draft/replacement revision
 * might separately be in flight for the same story right now (those are
 * two different moderation concerns; the story's OWN moderation-queue
 * entry, if any, already surfaces the in-flight revision separately).
 * get_story_for_moderator()/can_view_moderation_review() place no
 * revision_status filter on their lookup (confirmed by reading both
 * function bodies), so this link resolves for any past-published
 * revision, not only a currently-actionable one -- exactly what a
 * moderator triaging a report needs to see.
 */
export default async function ReportsTriagePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const rawParams = await searchParams;
  const filters = parseReportsQueueSearchParams(rawParams);
  const offset = (filters.page - 1) * REPORTS_QUEUE_PAGE_SIZE;

  let rows: Awaited<ReturnType<typeof listReportsForStaff>> = [];
  let loadError = false;
  try {
    rows = await listReportsForStaff({
      status: filters.status,
      category: filters.category,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      limit: REPORTS_QUEUE_PAGE_SIZE,
      offset,
    });
  } catch {
    loadError = true;
  }

  const hasNextPage = rows.length === REPORTS_QUEUE_PAGE_SIZE;
  const hasPrevPage = filters.page > 1;

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        Reports triage
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-black/60 dark:text-white/60">
        Every reader-submitted report, across every story. Private internal
        notes and resolution live on each report&rsquo;s own page, never here.
      </p>

      <form
        method="get"
        className="mt-6 grid grid-cols-2 gap-3 rounded-md border border-black/10 p-4 text-sm sm:grid-cols-4 dark:border-white/10"
      >
        <label className="flex flex-col gap-1">
          Status
          <select
            name="status"
            defaultValue={filters.status ?? ""}
            className="rounded-md border border-black/15 px-2 py-1 dark:border-white/15 dark:bg-transparent"
          >
            <option value="">Any</option>
            <option value="open">Open</option>
            <option value="reviewing">Reviewing</option>
            <option value="resolved">Resolved</option>
            <option value="dismissed">Dismissed</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Category
          <select
            name="category"
            defaultValue={filters.category ?? ""}
            className="rounded-md border border-black/15 px-2 py-1 dark:border-white/15 dark:bg-transparent"
          >
            <option value="">Any</option>
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          From
          <input
            type="date"
            name="dateFrom"
            defaultValue={filters.dateFrom ?? ""}
            className="rounded-md border border-black/15 px-2 py-1 dark:border-white/15 dark:bg-transparent"
          />
        </label>
        <label className="flex flex-col gap-1">
          To
          <input
            type="date"
            name="dateTo"
            defaultValue={filters.dateTo ?? ""}
            className="rounded-md border border-black/15 px-2 py-1 dark:border-white/15 dark:bg-transparent"
          />
        </label>
        <div className="flex items-end">
          <button
            type="submit"
            className="rounded-md bg-black px-3 py-1.5 font-medium text-white dark:bg-white dark:text-black"
          >
            Apply filters
          </button>
        </div>
      </form>

      <div className="mt-8" aria-live="polite">
        {loadError ? (
          <p className="rounded-md border border-black/10 bg-black/5 p-6 text-sm dark:border-white/10 dark:bg-white/5">
            Could not load reports right now. Please try again.
          </p>
        ) : rows.length === 0 ? (
          <p className="rounded-md border border-black/10 bg-black/5 p-6 text-sm dark:border-white/10 dark:bg-white/5">
            Nothing matches these filters.
          </p>
        ) : (
          <ul className="divide-y divide-black/10 dark:divide-white/10">
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex flex-col gap-1 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {CATEGORY_LABELS[row.category] ?? row.category}
                    </span>
                    <span className="rounded-full bg-black/10 px-2 py-0.5 text-xs dark:bg-white/10">
                      {STATUS_LABELS[row.status] ?? row.status}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-black/60 dark:text-white/60">
                    Reported {new Date(row.created_at).toLocaleString("en-NZ")}
                  </p>
                </div>
                <div className="flex gap-4 text-sm">
                  <Link
                    href={`/moderation/stories/${row.published_revision_id}`}
                    className="underline underline-offset-2"
                  >
                    View story
                  </Link>
                  {/*
                    list_reports_for_staff() has no p_report_id filter (by
                    design -- it only ever scopes by status/category/date
                    range/story, see the migration's own comment). The
                    detail page below re-fetches scoped by story_id (the
                    same p_story_id filter the story review page already
                    uses) rather than an unbounded/paginated scan for a
                    single row, so storyId travels as a query param here.
                  */}
                  <Link
                    href={`/moderation/reports/${row.id}?storyId=${row.story_id}`}
                    className="underline underline-offset-2"
                  >
                    Triage
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-8 flex items-center justify-between text-sm">
        <span className="text-black/60 dark:text-white/60">
          Page {filters.page}
        </span>
        <div className="flex gap-3">
          {hasPrevPage && (
            <Link
              href={buildHref("/moderation/reports", rawParams, {
                page: String(filters.page - 1),
              })}
              className="underline underline-offset-2"
            >
              Previous
            </Link>
          )}
          {hasNextPage && (
            <Link
              href={buildHref("/moderation/reports", rawParams, {
                page: String(filters.page + 1),
              })}
              className="underline underline-offset-2"
            >
              Next
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
