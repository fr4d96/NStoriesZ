import type { Metadata } from "next";
import Link from "next/link";
import {
  getContentReadinessQueue,
  getOperationalMetrics,
} from "@/lib/story/readiness";
import {
  parseReadinessQueueSearchParams,
  READINESS_QUEUE_PAGE_SIZE,
} from "@/lib/validation/readiness";
import { VerifyForm } from "./verify-form";

export const metadata: Metadata = {
  title: "Content Readiness",
  robots: { index: false, follow: false },
};

// Staff content, always reflects the caller's own current view -- never
// cached/pre-rendered, same convention as /editorial and /moderation.
export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

const CHECKLIST_ITEMS: {
  key: keyof Awaited<ReturnType<typeof getContentReadinessQueue>>[number];
  label: string;
}[] = [
  { key: "excerpt_present", label: "Title & excerpt" },
  { key: "body_present", label: "Story body" },
  { key: "trip_date_or_year_present", label: "Trip date/year" },
  { key: "region_selected", label: "Region" },
  { key: "tags_selected", label: "Tags" },
  { key: "images_uploaded", label: "Images uploaded" },
  { key: "cover_selected", label: "Cover selected" },
  { key: "alt_text_complete", label: "Alt text" },
  { key: "image_rights_confirmed", label: "Image rights" },
  { key: "identifiable_people_resolved", label: "Identifiable people" },
  { key: "publication_consent_complete", label: "Publication consent" },
  { key: "editorial_review_complete", label: "Editorial review" },
];

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

const METRIC_LABELS: { key: string; label: string }[] = [
  { key: "draft_imports_count", label: "Draft imports" },
  {
    key: "awaiting_contributor_approval_count",
    label: "Awaiting contributor approval",
  },
  { key: "awaiting_moderation_count", label: "Awaiting moderation" },
  { key: "published_count", label: "Published" },
  { key: "missing_consent_count", label: "Missing consent" },
  { key: "images_missing_alt_text_count", label: "Images missing alt text" },
  { key: "open_reports_count", label: "Open reports" },
];

export default async function ReadinessDashboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const rawParams = await searchParams;
  const filters = parseReadinessQueueSearchParams(rawParams);
  const offset = (filters.page - 1) * READINESS_QUEUE_PAGE_SIZE;

  let rows: Awaited<ReturnType<typeof getContentReadinessQueue>> = [];
  let metrics: Awaited<ReturnType<typeof getOperationalMetrics>> = null;
  let loadError = false;
  try {
    [rows, metrics] = await Promise.all([
      getContentReadinessQueue({
        sourceKind: filters.sourceKind,
        lifecycleStatus: filters.lifecycleStatus,
        limit: READINESS_QUEUE_PAGE_SIZE,
        offset,
      }),
      getOperationalMetrics(),
    ]);
  } catch {
    loadError = true;
  }

  const totalCount = rows[0]?.total_count ?? 0;
  const hasNextPage = offset + rows.length < totalCount;
  const hasPrevPage = filters.page > 1;

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        Content readiness
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-black/60 dark:text-white/60">
        An operational checklist for the founding catalogue, not legal advice.
        Nothing here changes a story&apos;s publication state — it only shows
        where each story stands.
      </p>

      {metrics && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {METRIC_LABELS.map((m) => (
            <div
              key={m.key}
              className="rounded-md border border-black/10 p-3 text-center dark:border-white/10"
            >
              <div className="text-xl font-semibold">
                {String((metrics as Record<string, unknown>)[m.key] ?? 0)}
              </div>
              <div className="text-xs text-black/60 dark:text-white/60">
                {m.label}
              </div>
            </div>
          ))}
        </div>
      )}

      <form
        method="get"
        className="mt-8 grid grid-cols-2 gap-3 rounded-md border border-black/10 p-4 text-sm sm:grid-cols-3 dark:border-white/10"
      >
        <label className="flex flex-col gap-1">
          Source
          <select
            name="sourceKind"
            defaultValue={filters.sourceKind ?? ""}
            className="rounded-md border border-black/15 px-2 py-1 dark:border-white/15 dark:bg-transparent"
          >
            <option value="">Any</option>
            <option value="self_submitted">Self-service</option>
            <option value="editorial_import">Editorial import</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Status
          <select
            name="lifecycleStatus"
            defaultValue={filters.lifecycleStatus ?? ""}
            className="rounded-md border border-black/15 px-2 py-1 dark:border-white/15 dark:bg-transparent"
          >
            <option value="">Any</option>
            <option value="draft">Draft</option>
            <option value="awaiting_contributor_approval">
              Awaiting contributor approval
            </option>
            <option value="pending_review">Pending review</option>
            <option value="changes_requested">Changes requested</option>
            <option value="published">Published</option>
            <option value="rejected">Rejected</option>
            <option value="archived">Archived</option>
          </select>
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
          <p className="rounded-md border border-black/10 bg-black/5 p-6 text-sm dark:border-white/10 dark:bg-white/5">
            Could not load the readiness queue right now. Please try again.
          </p>
        ) : rows.length === 0 ? (
          <p className="rounded-md border border-black/10 bg-black/5 p-6 text-sm dark:border-white/10 dark:bg-white/5">
            Nothing matches these filters.
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {rows.map((row) => (
              <li
                key={row.story_id}
                className="rounded-md border border-black/10 p-4 dark:border-white/10"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-medium">
                      {row.title ?? "(untitled)"}
                    </span>{" "}
                    <span className="text-xs text-black/60 dark:text-white/60">
                      /{row.slug} · {row.source_kind} · {row.lifecycle_status}
                    </span>
                  </div>
                  {row.source_kind === "editorial_import" ? (
                    <Link
                      href={`/editorial/${row.story_id}/edit`}
                      className="text-sm underline underline-offset-2"
                    >
                      Open in editorial
                    </Link>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-black/60 dark:text-white/60">
                  Contributor: {row.contributor_display_name} (
                  {row.contributor_linked ? "linked" : "unlinked"}) —{" "}
                  {row.attribution_type}
                </p>

                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  {CHECKLIST_ITEMS.map((item) => {
                    const ok = Boolean(row[item.key]);
                    return (
                      <span
                        key={item.key}
                        className={
                          ok
                            ? "text-green-700 dark:text-green-400"
                            : "text-amber-700 dark:text-amber-400"
                        }
                      >
                        {ok ? "✓" : "○"} {item.label}
                      </span>
                    );
                  })}
                </div>

                {row.last_moderation_reason && (
                  <p className="mt-2 text-xs text-black/60 dark:text-white/60">
                    Last moderation note: {row.last_moderation_reason}
                  </p>
                )}

                {row.lifecycle_status === "published" && (
                  <VerifyForm
                    storyId={row.story_id}
                    lastVerifiedAt={row.last_verified_at}
                    lastVerifiedDesktop={row.last_verified_desktop}
                    lastVerifiedMobile={row.last_verified_mobile}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-8 flex items-center justify-between text-sm">
        <span className="text-black/60 dark:text-white/60">
          {totalCount} total
        </span>
        <div className="flex gap-3">
          {hasPrevPage && (
            <Link
              href={buildHref("/readiness", rawParams, {
                page: String(filters.page - 1),
              })}
              className="underline underline-offset-2"
            >
              Previous
            </Link>
          )}
          {hasNextPage && (
            <Link
              href={buildHref("/readiness", rawParams, {
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
