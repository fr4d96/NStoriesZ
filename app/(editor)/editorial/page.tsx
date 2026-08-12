import type { Metadata } from "next";
import Link from "next/link";
import { listEditorialQueue } from "@/lib/story/moderation";
import {
  parseEditorialQueueSearchParams,
  EDITORIAL_QUEUE_PAGE_SIZE,
} from "@/lib/validation/moderation";
import { StatusBadge } from "@/app/(contributor)/my-stories/status-badge";
import { ReassignForm } from "./reassign-form";

export const metadata: Metadata = {
  title: "Editorial Dashboard",
  robots: { index: false, follow: false },
};

// Staff content, never cached/pre-rendered -- always reflects the caller's
// own current view of the queue.
export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Prompt 6 Stage 2: switched from the flat, unfiltered
 * listAssignedEditorialStories() to list_editorial_queue() -- a single
 * filterable view (status dropdown + free-text search + pagination) rather
 * than separate "awaiting-approval" / "returned-for-changes" tabs, since
 * list_editorial_queue()'s own p_status parameter already covers every
 * lifecycle_status value generically and a second, separate query per tab
 * would just be this same call made twice. listAssignedEditorialStories()
 * itself is left untouched (nothing else calls it, but Stage 1 confirmed
 * no other call site depends on it either way).
 */
export default async function EditorialDashboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const rawParams = await searchParams;
  const filters = parseEditorialQueueSearchParams(rawParams);
  const offset = (filters.page - 1) * EDITORIAL_QUEUE_PAGE_SIZE;

  let stories: Awaited<ReturnType<typeof listEditorialQueue>> = [];
  let loadError = false;
  try {
    stories = await listEditorialQueue({
      status: filters.status,
      search: filters.search,
      limit: EDITORIAL_QUEUE_PAGE_SIZE,
      offset,
    });
  } catch {
    loadError = true;
  }

  const totalCount = stories[0]?.total_count ?? 0;
  const hasNextPage = offset + stories.length < totalCount;
  const hasPrevPage = filters.page > 1;

  function pageHref(page: number) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(rawParams)) {
      if (typeof value === "string" && key !== "page") params.set(key, value);
    }
    params.set("page", String(page));
    return `/editorial?${params.toString()}`;
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Editorial Dashboard
        </h1>
        <Link
          href="/editorial/new"
          className="inline-flex items-center justify-center rounded-md bg-black px-4 py-2 text-sm font-semibold text-white dark:bg-white dark:text-black"
        >
          New Import
        </Link>
      </div>

      <form
        method="get"
        className="mt-6 flex flex-wrap items-end gap-3 rounded-md border border-black/10 p-4 text-sm dark:border-white/10"
      >
        <label className="flex flex-col gap-1">
          Status
          <select
            name="status"
            defaultValue={filters.status ?? ""}
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
        <label className="flex flex-col gap-1">
          Search
          <input
            type="text"
            name="search"
            defaultValue={filters.search ?? ""}
            placeholder="Title or slug"
            className="rounded-md border border-black/15 px-2 py-1 dark:border-white/15 dark:bg-transparent"
          />
        </label>
        <button
          type="submit"
          className="rounded-md bg-black px-3 py-1.5 font-medium text-white dark:bg-white dark:text-black"
        >
          Apply
        </button>
      </form>

      <div className="mt-8" aria-live="polite">
        {loadError ? (
          <p className="text-black/70 dark:text-white/70">
            Could not load the editorial queue right now.
          </p>
        ) : stories.length === 0 ? (
          <p className="text-black/70 dark:text-white/70">
            Nothing matches these filters.{" "}
            <Link
              href="/editorial/new"
              className="underline underline-offset-2"
            >
              Start one
            </Link>
            .
          </p>
        ) : (
          <ul className="divide-y divide-black/10 dark:divide-white/10">
            {stories.map((story) => (
              <li
                key={story.story_id}
                className="flex flex-col gap-2 py-4 sm:flex-row sm:items-start sm:justify-between"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{story.slug}</span>
                    <StatusBadge status={story.lifecycle_status} />
                  </div>
                  <p className="mt-1 text-sm text-black/60 dark:text-white/60">
                    {story.assigned_editor_id ? "Assigned" : "Unclaimed"} —
                    updated{" "}
                    {new Date(story.updated_at).toLocaleDateString("en-NZ")}
                  </p>
                  <ReassignForm
                    storyId={story.story_id}
                    expectedVersion={story.version}
                  />
                </div>
                <Link
                  href={`/editorial/${story.story_id}/edit`}
                  className="text-sm underline underline-offset-2"
                >
                  Open
                </Link>
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
              href={pageHref(filters.page - 1)}
              className="underline underline-offset-2"
            >
              Previous
            </Link>
          )}
          {hasNextPage && (
            <Link
              href={pageHref(filters.page + 1)}
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
