import type { Metadata } from "next";
import Link from "next/link";
import {
  getModerationQueue,
  listReportsForStaff,
  type ModerationQueueRow,
} from "@/lib/story/moderation";
import { getOperationalMetrics } from "@/lib/story/readiness";
import {
  DAY_MS,
  QUEUE_OVERDUE_HOURS,
  bucketQueueAges,
  buildReportTrend,
  formatWait,
  oldestWaitingHours,
  sortByLongestWaiting,
  sumCounts,
  summarizeReportCategories,
  summarizeReportStatuses,
  summarizeSubmissionKinds,
  waitingHours,
} from "@/lib/story/moderation-analytics";
import {
  AgeStackedBar,
  BarList,
  DataTable,
  Panel,
  SectionHeading,
  StatTile,
  TrendColumns,
} from "./dashboard-charts";

export const metadata: Metadata = {
  title: "Moderation",
  robots: { index: false, follow: false },
};

// Staff content, always the caller's own current view -- never cached or
// pre-rendered, same convention as the queue page and /editorial.
export const dynamic = "force-dynamic";

/** get_moderation_queue clamps p_limit to 50; this is how far we page. */
const SAMPLE_PAGE_SIZE = 50;
const MAX_SAMPLE_PAGES = 4;
const REPORT_SAMPLE_SIZE = 50;
const TREND_DAYS = 14;

/**
 * The queue is ordered newest-submission-first, so a single page is not
 * necessarily the oldest work. We page up to MAX_SAMPLE_PAGES so the
 * age/mix figures are exact for any realistic founding-catalogue backlog,
 * and report the sample as a sample when it is not.
 */
async function sampleSubmittedQueue(): Promise<{
  rows: ModerationQueueRow[];
  total: number;
  sampled: boolean;
}> {
  const first = await getModerationQueue({
    status: "submitted",
    limit: SAMPLE_PAGE_SIZE,
  });
  const total = first[0]?.total_count ?? 0;

  const remainingPages = Math.min(
    Math.ceil(Math.max(total - SAMPLE_PAGE_SIZE, 0) / SAMPLE_PAGE_SIZE),
    MAX_SAMPLE_PAGES - 1,
  );

  const rest = await Promise.all(
    Array.from({ length: remainingPages }, (_, i) =>
      getModerationQueue({
        status: "submitted",
        limit: SAMPLE_PAGE_SIZE,
        offset: (i + 1) * SAMPLE_PAGE_SIZE,
      }),
    ),
  );

  const rows = [first, ...rest].flat();
  return { rows, total, sampled: rows.length < total };
}

/**
 * Exact decision counts for a window: the recently_reviewed branch filters
 * on the moderation ACTION's timestamp and returns count(*) over (), so one
 * row is enough to read the whole window's total.
 */
async function countDecisions(from: Date, to?: Date): Promise<number> {
  const rows = await getModerationQueue({
    status: "recently_reviewed",
    dateFrom: from.toISOString(),
    dateTo: to?.toISOString(),
    limit: 1,
  });
  return rows[0]?.total_count ?? 0;
}

function formatDelta(current: number, previous: number): string {
  const diff = current - previous;
  if (diff === 0) return "Level with the previous 7 days";
  const direction = diff > 0 ? "+" : "−";
  return `${direction}${Math.abs(diff)} vs the previous 7 days`;
}

export default async function ModerationOverviewPage() {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const twoWeeksAgo = new Date(now.getTime() - 14 * DAY_MS);

  let metrics: Awaited<ReturnType<typeof getOperationalMetrics>> = null;
  let queue: Awaited<ReturnType<typeof sampleSubmittedQueue>> = {
    rows: [],
    total: 0,
    sampled: false,
  };
  let reports: Awaited<ReturnType<typeof listReportsForStaff>> = [];
  let decidedThisWeek = 0;
  let decidedLastWeek = 0;
  let loadError = false;

  try {
    [metrics, queue, reports, decidedThisWeek, decidedLastWeek] =
      await Promise.all([
        getOperationalMetrics(),
        sampleSubmittedQueue(),
        listReportsForStaff({ limit: REPORT_SAMPLE_SIZE }),
        countDecisions(weekAgo),
        countDecisions(twoWeeksAgo, weekAgo),
      ]);
  } catch {
    loadError = true;
  }

  const ageBuckets = bucketQueueAges(queue.rows, now);
  const oldestHours = oldestWaitingHours(queue.rows, now);
  const overdueCount =
    ageBuckets.find((b) => b.key === "over_seven_days")?.count ?? 0;
  const submissionMix = summarizeSubmissionKinds(queue.rows);
  const reportCategories = summarizeReportCategories(reports);
  const reportStatuses = summarizeReportStatuses(reports);
  const reportTrend = buildReportTrend(reports, now, TREND_DAYS);
  const reportsThisFortnight = sumCounts(reportTrend);
  const oldestFive = sortByLongestWaiting(queue.rows, now).slice(0, 5);

  const awaitingModeration = metrics?.awaiting_moderation_count ?? queue.total;
  const openReports = metrics?.open_reports_count ?? 0;

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
      <header>
        <p className="font-mono text-[0.625rem] tracking-[0.18em] text-muted-foreground uppercase">
          As of{" "}
          <time dateTime={now.toISOString()}>
            {now.toLocaleString("en-NZ", {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </time>
        </p>
        <h1 className="mt-2 text-2xl font-extrabold tracking-[-.03em] sm:text-3xl">
          Moderation
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          What is waiting, how long it has been waiting, and what readers are
          reporting. Counts are aggregates only — no per-contributor or
          per-moderator breakdown.
        </p>
      </header>

      {loadError ? (
        <p className="mt-8 rounded-xl border border-border-subtle bg-surface-muted p-6 text-sm">
          Could not load moderation figures right now. The{" "}
          <Link
            href="/moderation/stories"
            className="underline underline-offset-2"
          >
            stories queue
          </Link>{" "}
          and{" "}
          <Link
            href="/moderation/reports"
            className="underline underline-offset-2"
          >
            reports
          </Link>{" "}
          are still available.
        </p>
      ) : (
        <>
          <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              label="Awaiting moderation"
              value={String(awaitingModeration)}
              hint={
                awaitingModeration === 0
                  ? "Queue is clear"
                  : "Submitted revisions needing a decision"
              }
              tone="accent"
              href="/moderation/stories"
            />
            <StatTile
              label="Longest wait"
              value={oldestHours === null ? "—" : formatWait(oldestHours)}
              hint={
                overdueCount > 0
                  ? `${overdueCount} over 7 days`
                  : "Nothing past 7 days"
              }
              tone={
                oldestHours !== null && oldestHours >= QUEUE_OVERDUE_HOURS
                  ? "critical"
                  : "default"
              }
            />
            <StatTile
              label="Open reports"
              value={String(openReports)}
              hint="Open or under review"
              tone={openReports > 0 ? "critical" : "default"}
              href="/moderation/reports"
            />
            <StatTile
              label="Decided, 7 days"
              value={String(decidedThisWeek)}
              hint={formatDelta(decidedThisWeek, decidedLastWeek)}
            />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Panel className="flex flex-col">
              <SectionHeading
                title="Queue pressure"
                description={
                  queue.sampled
                    ? `Across the ${queue.rows.length} most recent of ${queue.total} submissions.`
                    : "Every submission currently awaiting a decision."
                }
              />
              {sumCounts(ageBuckets) === 0 ? (
                <p className="mt-5 text-sm text-muted-foreground">
                  Nothing is waiting for a decision.
                </p>
              ) : (
                <>
                  <div className="mt-5">
                    <h3 className="font-mono text-[0.625rem] tracking-[0.18em] text-muted-foreground uppercase">
                      How long it has been waiting
                    </h3>
                    <div className="mt-3">
                      <AgeStackedBar
                        buckets={ageBuckets}
                        caption="Submissions awaiting a decision, split by how long they have been waiting."
                      />
                    </div>
                  </div>

                  <div className="mt-6 border-t border-border-subtle pt-5">
                    <h3 className="font-mono text-[0.625rem] tracking-[0.18em] text-muted-foreground uppercase">
                      What kind of submission
                    </h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      A replacement changes what is already public; a
                      resubmission follows an earlier decision.
                    </p>
                    <div className="mt-3">
                      <BarList
                        items={submissionMix}
                        emptyLabel="Nothing is waiting for a decision."
                        ariaLabel="Submissions waiting by kind"
                      />
                    </div>
                  </div>

                  <DataTable
                    summary="Show as table"
                    columns={["Waiting", "Submissions"]}
                    rows={ageBuckets.map((b) => ({
                      key: b.key,
                      label: b.label,
                      count: b.count,
                    }))}
                  />
                </>
              )}
            </Panel>

            <Panel className="flex flex-col">
              <SectionHeading
                title="Waiting longest"
                description="The front of the queue by wait time, not by arrival."
                action={{
                  href: "/moderation/stories",
                  label: "Open the queue",
                }}
              />
              {oldestFive.length === 0 ? (
                <p className="mt-5 text-sm text-muted-foreground">
                  Nothing is waiting for a decision.
                </p>
              ) : (
                <ul className="mt-2 divide-y divide-border-subtle">
                  {oldestFive.map((row) => {
                    const hours = waitingHours(row, now);
                    const overdue =
                      hours !== null && hours >= QUEUE_OVERDUE_HOURS;
                    return (
                      <li
                        key={row.revision_id}
                        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3"
                      >
                        <div className="min-w-0">
                          <Link
                            href={`/moderation/stories/${row.revision_id}`}
                            className="font-bold underline-offset-4 hover:underline"
                          >
                            {row.title}
                          </Link>
                          <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                            /{row.slug}
                          </p>
                        </div>
                        {hours !== null ? (
                          <span
                            className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-xs tabular-nums ${
                              overdue
                                ? "bg-destructive/12 text-destructive"
                                : "bg-tag-background text-tag-foreground"
                            }`}
                          >
                            {overdue ? "overdue " : "waiting "}
                            {formatWait(hours)}
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Panel className="flex flex-col">
              <SectionHeading
                title="Reports received"
                description={`${reportsThisFortnight} in the last ${TREND_DAYS} days, by day (UTC).`}
              />
              <div className="mt-5">
                <TrendColumns
                  points={reportTrend}
                  ariaLabel={`Reports received per day over the last ${TREND_DAYS} days`}
                />
              </div>
              {reportStatuses.length > 0 ? (
                <div className="mt-6 border-t border-border-subtle pt-5">
                  <h3 className="font-mono text-[0.625rem] tracking-[0.18em] text-muted-foreground uppercase">
                    Where those reports stand
                  </h3>
                  <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
                    {reportStatuses.map((status) => (
                      <li key={status.key}>
                        <span className="block font-mono text-lg tabular-nums">
                          {status.count}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {status.label}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <DataTable
                summary="Show as table"
                columns={["Day", "Reports"]}
                rows={reportTrend.map((point) => ({
                  key: point.date,
                  label: point.date,
                  count: point.count,
                }))}
              />
            </Panel>

            <Panel className="flex flex-col">
              <SectionHeading
                title="What readers are reporting"
                description={
                  reports.length === 0
                    ? "No reader has filed a report yet."
                    : `Across the ${reports.length} most recent reports, whatever their status.`
                }
                action={{
                  href: "/moderation/reports",
                  label: "Triage reports",
                }}
              />
              <div className="mt-5">
                <BarList
                  items={reportCategories}
                  emptyLabel="No reports have been filed."
                  ariaLabel="Reports by category"
                />
              </div>
            </Panel>
          </div>

          <section className="mt-4">
            <SectionHeading
              title="Catalogue health"
              description="Upstream of moderation — these are editorial and readiness signals, not decisions to make here."
              action={{ href: "/readiness", label: "Content readiness" }}
            />
            <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile
                label="Published"
                value={String(metrics?.published_count ?? 0)}
                hint="Live stories"
              />
              <StatTile
                label="Draft imports"
                value={String(metrics?.draft_imports_count ?? 0)}
                hint="Editorial imports not yet submitted"
              />
              <StatTile
                label="Missing consent"
                value={String(metrics?.missing_consent_count ?? 0)}
                hint="Stories with no consent record"
              />
              <StatTile
                label="Images missing alt text"
                value={String(metrics?.images_missing_alt_text_count ?? 0)}
                hint="On each story's current draft"
              />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
