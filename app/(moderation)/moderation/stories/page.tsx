import type { Metadata } from "next";
import Link from "next/link";
import { getModerationQueue } from "@/lib/story/moderation";
import {
  parseModerationQueueSearchParams,
  MODERATION_QUEUE_PAGE_SIZE,
} from "@/lib/validation/moderation";
import { listActiveRegions } from "@/lib/story/active-lookups";
import {
  SUBMISSION_KIND_LABELS,
  SOURCE_KIND_LABELS,
  DECISION_LABELS,
  labelFor,
  queueSignals,
  isEmptySubmission,
  contentLengthLabel,
  relativeTime,
  absoluteTime,
  submitterLabel,
} from "@/lib/story/moderation-queue-view";
import { ArrowRightIcon } from "@/components/icons";

export const metadata: Metadata = {
  title: "Moderation Queue",
  robots: { index: false, follow: false },
};

// Staff content, always reflects the caller's own current view of the
// queue -- never cached/pre-rendered, same convention as /editorial.
export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

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

const FIELD_CLASSES =
  "rounded-md border border-border-subtle bg-surface-muted px-3 py-2 text-sm text-foreground transition-colors duration-150 hover:border-foreground/30 focus:border-accent focus:outline-none";

const FIELD_LABEL_CLASSES =
  "font-mono text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground";

const SIGNAL_TONE_CLASSES = {
  alert:
    "border-destructive/45 bg-destructive/10 text-destructive dark:text-destructive",
  warn: "border-amber-600/40 bg-amber-500/10 text-amber-800 dark:border-amber-500/40 dark:text-amber-300",
  neutral: "border-border-subtle bg-surface-muted text-muted-foreground",
} as const;

export default async function ModerationStoriesQueuePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const rawParams = await searchParams;
  const filters = parseModerationQueueSearchParams(rawParams);

  const regions = await listActiveRegions();

  const offset = (filters.page - 1) * MODERATION_QUEUE_PAGE_SIZE;
  const status = filters.status ?? "submitted";
  const isReviewedView = status === "recently_reviewed";

  let rows: Awaited<ReturnType<typeof getModerationQueue>> = [];
  let loadError = false;
  try {
    rows = await getModerationQueue({
      status,
      sourceKind: filters.sourceKind,
      regionId: filters.regionId,
      consentMethod: filters.consentMethod,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      limit: MODERATION_QUEUE_PAGE_SIZE,
      offset,
    });
  } catch {
    loadError = true;
  }

  const totalCount = rows[0]?.total_count ?? 0;
  const hasNextPage = offset + rows.length < totalCount;
  const hasPrevPage = filters.page > 1;

  // A single `now` for the whole render, so two rows submitted in the same
  // minute can never disagree about how long ago that was.
  const now = new Date();

  // Counted over THIS page only, and says so -- claiming a queue-wide
  // figure would be a lie, since the RPC returns at most 50 rows and the
  // window count is the only queue-wide number available.
  const emptyOnPage = rows.filter(isEmptySubmission).length;
  const reportedOnPage = rows.filter((r) => r.open_report_count > 0).length;

  const anyFilterSet = Boolean(
    filters.sourceKind ||
    filters.regionId ||
    filters.consentMethod ||
    filters.dateFrom ||
    filters.dateTo,
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Stories queue
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          {isReviewedView
            ? "Decisions already made, most recent first."
            : "Everything waiting on a decision, newest submission first."}
        </p>

        {/*
          The counts a moderator would otherwise get by opening every entry.
          Mono numerals per the Mono-Means-Record Rule -- these are record
          fields, not prose.
        */}
        {!loadError && rows.length > 0 && (
          <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-3 border-t border-border-subtle pt-5">
            <div>
              <dt className={FIELD_LABEL_CLASSES}>
                {isReviewedView ? "Decisions" : "Waiting"}
              </dt>
              <dd className="mt-1 font-mono text-xl">{totalCount}</dd>
            </div>
            {emptyOnPage > 0 && (
              <div>
                <dt className={FIELD_LABEL_CLASSES}>Empty on this page</dt>
                <dd className="mt-1 font-mono text-xl text-destructive">
                  {emptyOnPage}
                </dd>
              </div>
            )}
            {reportedOnPage > 0 && (
              <div>
                <dt className={FIELD_LABEL_CLASSES}>Reported on this page</dt>
                <dd className="mt-1 font-mono text-xl text-destructive">
                  {reportedOnPage}
                </dd>
              </div>
            )}
          </dl>
        )}
      </header>

      <form
        method="get"
        className="mt-8 rounded-xl border border-border-subtle p-4 sm:p-5"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="flex flex-col gap-1.5">
            <span className={FIELD_LABEL_CLASSES}>Status</span>
            <select
              name="status"
              defaultValue={status}
              className={FIELD_CLASSES}
            >
              <option value="submitted">Waiting on a decision</option>
              <option value="recently_reviewed">Recently reviewed</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={FIELD_LABEL_CLASSES}>Source</span>
            <select
              name="sourceKind"
              defaultValue={filters.sourceKind ?? ""}
              className={FIELD_CLASSES}
            >
              <option value="">Any source</option>
              <option value="self_submitted">Self-service</option>
              <option value="editorial_import">Editorial import</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={FIELD_LABEL_CLASSES}>Region</span>
            <select
              name="regionId"
              defaultValue={filters.regionId ?? ""}
              className={FIELD_CLASSES}
            >
              <option value="">Any region</option>
              {regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={FIELD_LABEL_CLASSES}>Consent method</span>
            <select
              name="consentMethod"
              defaultValue={filters.consentMethod ?? ""}
              className={FIELD_CLASSES}
            >
              <option value="">Any method</option>
              <option value="account">Account</option>
              <option value="email">Email</option>
              <option value="written_message">Written message</option>
              <option value="in_person">In person</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={FIELD_LABEL_CLASSES}>From</span>
            <input
              type="date"
              name="dateFrom"
              defaultValue={filters.dateFrom ?? ""}
              className={FIELD_CLASSES}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={FIELD_LABEL_CLASSES}>To</span>
            <input
              type="date"
              name="dateTo"
              defaultValue={filters.dateTo ?? ""}
              className={FIELD_CLASSES}
            />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <button
            type="submit"
            className="rounded-full bg-accent px-5 py-2.5 text-sm font-bold text-accent-foreground transition-opacity duration-150 hover:opacity-90"
          >
            Apply filters
          </button>
          {anyFilterSet && (
            <Link
              href={`/moderation/stories?status=${status}`}
              className="text-sm underline underline-offset-4 hover:text-accent"
            >
              Clear filters
            </Link>
          )}
        </div>
      </form>

      <div className="mt-8" aria-live="polite">
        {loadError ? (
          <p className="rounded-xl border border-border-subtle bg-surface-muted p-6 text-sm">
            Could not load the queue right now. Please try again.
          </p>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-border-subtle bg-surface-muted p-8 text-center">
            <p className="text-sm font-semibold">
              {anyFilterSet
                ? "Nothing matches these filters."
                : isReviewedView
                  ? "No decisions recorded yet."
                  : "Nothing is waiting on a decision."}
            </p>
            {anyFilterSet && (
              <Link
                href={`/moderation/stories?status=${status}`}
                className="mt-3 inline-block text-sm underline underline-offset-4 hover:text-accent"
              >
                Clear filters
              </Link>
            )}
          </div>
        ) : (
          <ul className="space-y-3">
            {rows.map((row) => {
              const signals = queueSignals(row);
              const empty = isEmptySubmission(row);
              const stamp = isReviewedView ? row.decided_at : row.submitted_at;
              const relative = relativeTime(stamp, now);
              const absolute = absoluteTime(stamp);

              return (
                <li
                  key={
                    // The recently_reviewed branch is one row per DECISION,
                    // so a revision decided twice appears twice and
                    // revision_id alone is not unique there.
                    isReviewedView
                      ? `${row.revision_id}-${row.decided_at ?? ""}`
                      : row.revision_id
                  }
                  className={`group relative rounded-xl border p-4 transition-colors duration-150 sm:p-5 ${
                    empty
                      ? "border-destructive/40 bg-destructive/[0.04] hover:border-destructive/70"
                      : "border-border-subtle hover:border-foreground/30"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                    <span className="rounded-full border border-border-subtle px-2.5 py-0.5 font-mono text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      {labelFor(SUBMISSION_KIND_LABELS, row.submission_kind)}
                    </span>
                    {row.source_kind === "editorial_import" && (
                      <span className="rounded-full border border-border-subtle px-2.5 py-0.5 font-mono text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        {labelFor(SOURCE_KIND_LABELS, row.source_kind)}
                      </span>
                    )}
                    {isReviewedView && row.decision && (
                      <span className="rounded-full bg-tag-background px-2.5 py-0.5 font-mono text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-tag-foreground">
                        {labelFor(DECISION_LABELS, row.decision)}
                      </span>
                    )}
                    {row.revision_number > 1 && (
                      <span className="font-mono text-[0.65rem] text-muted-foreground">
                        rev #{row.revision_number}
                      </span>
                    )}
                  </div>

                  <h2 className="mt-2 text-lg font-semibold tracking-tight">
                    {/*
                      Stretched link: the whole card is the hit target (a
                      42px "Review" text link on a phone was not), while the
                      accessible name stays just the story title.
                    */}
                    <Link
                      href={`/moderation/stories/${row.revision_id}`}
                      className="after:absolute after:inset-0 after:content-[''] hover:text-accent focus-visible:text-accent"
                    >
                      {row.title}
                    </Link>
                  </h2>

                  <p className="mt-1 text-sm text-muted-foreground">
                    <span className="text-foreground/80">
                      {submitterLabel(row)}
                    </span>
                    {relative && (
                      <>
                        {" · "}
                        <span title={absolute ?? undefined}>
                          {isReviewedView ? "decided" : "submitted"} {relative}
                        </span>
                      </>
                    )}
                  </p>

                  <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                    /{row.slug} · {contentLengthLabel(row.content_text_length)}
                  </p>

                  {signals.length > 0 && (
                    <ul className="mt-3 flex flex-wrap gap-1.5">
                      {signals.map((signal) => (
                        <li
                          key={signal.id}
                          className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${SIGNAL_TONE_CLASSES[signal.tone]}`}
                        >
                          {signal.label}
                        </li>
                      ))}
                    </ul>
                  )}

                  <ArrowRightIcon
                    aria-hidden="true"
                    className="pointer-events-none absolute right-4 top-1/2 hidden h-5 w-5 -translate-y-1/2 text-muted-foreground transition-transform duration-150 group-hover:translate-x-1 group-hover:text-accent sm:block"
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {(hasPrevPage || hasNextPage) && (
        <nav
          aria-label="Queue pages"
          className="mt-8 flex items-center justify-between border-t border-border-subtle pt-5 text-sm"
        >
          <span className="font-mono text-xs text-muted-foreground">
            {offset + 1}–{offset + rows.length} of {totalCount}
          </span>
          <div className="flex gap-4">
            {hasPrevPage && (
              <Link
                href={buildHref("/moderation/stories", rawParams, {
                  page: String(filters.page - 1),
                })}
                className="underline underline-offset-4 hover:text-accent"
              >
                Previous
              </Link>
            )}
            {hasNextPage && (
              <Link
                href={buildHref("/moderation/stories", rawParams, {
                  page: String(filters.page + 1),
                })}
                className="underline underline-offset-4 hover:text-accent"
              >
                Next
              </Link>
            )}
          </div>
        </nav>
      )}
    </div>
  );
}
