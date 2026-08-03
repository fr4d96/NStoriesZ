import type { Metadata } from "next";
import Link from "next/link";
import { listMyStories } from "@/lib/story/contributor-queries";
import { StatusBadge } from "./status-badge";

export const metadata: Metadata = {
  title: "My Stories",
};

function formatDate(value: string | null): string | null {
  if (!value) return null;
  return new Date(value).toLocaleDateString("en-NZ", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default async function MyStoriesPage() {
  const stories = await listMyStories();

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          My Stories
        </h1>
        <Link
          href="/stories/new"
          className="inline-flex items-center justify-center rounded-md bg-black px-4 py-2 text-sm font-semibold text-white dark:bg-white dark:text-black"
        >
          New Story
        </Link>
      </div>

      {stories.length === 0 ? (
        <p className="mt-8 text-black/70 dark:text-white/70">
          You haven&apos;t started a story yet.{" "}
          <Link href="/stories/new" className="underline underline-offset-2">
            Start your first one
          </Link>
          .
        </p>
      ) : (
        <ul className="mt-8 divide-y divide-black/10 dark:divide-white/10">
          {stories.map((story) => {
            const editable = Boolean(story.current_draft_revision_id);
            const updated = formatDate(story.updated_at);
            return (
              <li
                key={story.id}
                className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{story.slug}</span>
                    <StatusBadge status={story.lifecycle_status} />
                  </div>
                  {updated && (
                    <p className="mt-1 text-sm text-black/60 dark:text-white/60">
                      Updated {updated}
                    </p>
                  )}
                </div>
                <div className="flex gap-3 text-sm">
                  {editable && (
                    <Link
                      href={`/stories/${story.id}/edit`}
                      className="underline underline-offset-2"
                    >
                      Edit
                    </Link>
                  )}
                  <Link
                    href={`/stories/${story.id}/preview`}
                    className="underline underline-offset-2"
                  >
                    Preview
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
