import type { Metadata } from "next";
import Link from "next/link";
import { getModerationQueue } from "@/lib/story/moderation";
import {
  parseModerationQueueSearchParams,
  MODERATION_QUEUE_PAGE_SIZE,
} from "@/lib/validation/moderation";
import { listActiveRegions } from "@/lib/story/active-lookups";

export const metadata: Metadata = {
  title: "Moderation Queue",
  robots: { index: false, follow: false },
};

// Staff content, always reflects the caller's own current view of the
// queue -- never cached/pre-rendered, same convention as /editorial.
export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

const SUBMISSION_KIND_LABELS: Record<string, string> = {
  first: "First submission",
  replacement: "Replacement",
  resubmission: "Resubmission",
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

export default async function ModerationStoriesQueuePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const rawParams = await searchParams;
  const filters = parseModerationQueueSearchParams(rawParams);

  const regions = await listActiveRegions();

  const offset = (filters.page - 1) * MODERATION_QUEUE_PAGE_SIZE;

  let rows: Awaited<ReturnType<typeof getModerationQueue>> = [];
  let loadError = false;
  try {
    rows = await getModerationQueue({
      status: filters.status ?? "submitted",
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

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        Stories queue
      </h1>

      <form
        method="get"
        className="mt-6 grid grid-cols-2 gap-3 rounded-md border border-border-subtle p-4 text-sm sm:grid-cols-4"
      >
        <label className="flex flex-col gap-1">
          Status
          <select
            name="status"
            defaultValue={filters.status ?? "submitted"}
            className="rounded-md border border-border-subtle px-2 py-1 dark:bg-transparent"
          >
            <option value="submitted">Submitted (actionable)</option>
            <option value="recently_reviewed">Recently reviewed</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Source
          <select
            name="sourceKind"
            defaultValue={filters.sourceKind ?? ""}
            className="rounded-md border border-border-subtle px-2 py-1 dark:bg-transparent"
          >
            <option value="">Any</option>
            <option value="self_service">Self-service</option>
            <option value="editorial_import">Editorial import</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Region
          <select
            name="regionId"
            defaultValue={filters.regionId ?? ""}
            className="rounded-md border border-border-subtle px-2 py-1 dark:bg-transparent"
          >
            <option value="">Any</option>
            {regions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Consent method
          <select
            name="consentMethod"
            defaultValue={filters.consentMethod ?? ""}
            className="rounded-md border border-border-subtle px-2 py-1 dark:bg-transparent"
          >
            <option value="">Any</option>
            <option value="account">Account</option>
            <option value="email">Email</option>
            <option value="written_message">Written message</option>
            <option value="in_person">In person</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          From
          <input
            type="date"
            name="dateFrom"
            defaultValue={filters.dateFrom ?? ""}
            className="rounded-md border border-border-subtle px-2 py-1 dark:bg-transparent"
          />
        </label>
        <label className="flex flex-col gap-1">
          To
          <input
            type="date"
            name="dateTo"
            defaultValue={filters.dateTo ?? ""}
            className="rounded-md border border-border-subtle px-2 py-1 dark:bg-transparent"
          />
        </label>
        <div className="flex items-end">
          <button
            type="submit"
            className="rounded-md bg-accent px-3 py-1.5 font-medium text-accent-foreground"
          >
            Apply filters
          </button>
        </div>
      </form>

      <div className="mt-8" aria-live="polite">
        {loadError ? (
          <p className="rounded-md border border-border-subtle bg-surface-muted p-6 text-sm">
            Could not load the queue right now. Please try again.
          </p>
        ) : rows.length === 0 ? (
          <p className="rounded-md border border-border-subtle bg-surface-muted p-6 text-sm">
            Nothing matches these filters.
          </p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {rows.map((row) => (
              <li
                key={row.revision_id}
                className="flex flex-col gap-1 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{row.title}</span>
                    <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs">
                      {SUBMISSION_KIND_LABELS[row.submission_kind] ??
                        row.submission_kind}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    /{row.slug}
                    {row.submitted_at
                      ? ` — submitted ${new Date(row.submitted_at).toLocaleString("en-NZ")}`
                      : ""}
                  </p>
                </div>
                <Link
                  href={`/moderation/stories/${row.revision_id}`}
                  className="text-sm underline underline-offset-2"
                >
                  Review
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-8 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{totalCount} total</span>
        <div className="flex gap-3">
          {hasPrevPage && (
            <Link
              href={buildHref("/moderation/stories", rawParams, {
                page: String(filters.page - 1),
              })}
              className="underline underline-offset-2"
            >
              Previous
            </Link>
          )}
          {hasNextPage && (
            <Link
              href={buildHref("/moderation/stories", rawParams, {
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
