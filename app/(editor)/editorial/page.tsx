import type { Metadata } from "next";
import Link from "next/link";
import { listAssignedEditorialStories } from "@/lib/story/moderation";
import { StatusBadge } from "@/app/(contributor)/my-stories/status-badge";

export const metadata: Metadata = {
  title: "Editorial Dashboard",
  robots: { index: false, follow: false },
};

// Staff content, never cached/pre-rendered -- always reflects the caller's
// own current assignment list.
export const dynamic = "force-dynamic";

export default async function EditorialDashboardPage() {
  const stories = await listAssignedEditorialStories();

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
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

      {stories.length === 0 ? (
        <p className="mt-8 text-black/70 dark:text-white/70">
          No editorial-import stories are assigned to you yet.{" "}
          <Link href="/editorial/new" className="underline underline-offset-2">
            Start one
          </Link>
          .
        </p>
      ) : (
        <ul className="mt-8 divide-y divide-black/10 dark:divide-white/10">
          {stories.map((story) => (
            <li
              key={story.id}
              className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{story.slug}</span>
                  <StatusBadge status={story.lifecycle_status} />
                </div>
                <p className="mt-1 text-sm text-black/60 dark:text-white/60">
                  Updated{" "}
                  {new Date(story.updated_at).toLocaleDateString("en-NZ")}
                </p>
              </div>
              <Link
                href={`/editorial/${story.id}/edit`}
                className="text-sm underline underline-offset-2"
              >
                Open
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
