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
        <h1 className="journiq-heading text-[2.4rem]">My Stories</h1>
        <Link href="/stories/new" className="journiq-button bg-accent text-accent-foreground">
          New Story
        </Link>
      </div>

      {stories.length === 0 ? (
        <p className="mt-8 text-foreground/65">
          You haven&apos;t started a story yet.{" "}
          <Link href="/stories/new" className="text-accent underline underline-offset-2">
            Start your first one
          </Link>
          .
        </p>
      ) : (
        <ul className="mt-8 divide-y divide-border-subtle">
          {stories.map((story) => {
            // A story awaiting THIS contributor's approval still has
            // current_draft_revision_id set (mark_editorial_draft_awaiting_approval()
            // doesn't clear it), but the revision itself is frozen
            // (_revision_is_editable() excludes this lifecycle status) --
            // an "Edit" link here would lead to a save that always fails.
            // Prompt 4 Sub-phase 4 fix: show a "Review" CTA instead, so a
            // contributor can actually find and act on it from their normal
            // story list, not only by knowing the preview URL.
            const awaitingApproval =
              story.lifecycle_status === "awaiting_contributor_approval";
            const editable =
              Boolean(story.current_draft_revision_id) && !awaitingApproval;
            const updated = formatDate(story.updated_at);
            return (
              <li
                key={story.id}
                className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">
                      {story.title ?? "Untitled story"}
                    </span>
                    <StatusBadge status={story.lifecycle_status} />
                  </div>
                  {story.excerpt && (
                    <p className="mt-1 text-sm text-foreground/70">
                      {story.excerpt}
                    </p>
                  )}
                  {updated && (
                    <p className="mt-1 text-sm text-foreground/55">
                      Updated {updated}
                    </p>
                  )}
                </div>
                <div className="flex gap-3 text-sm font-bold">
                  {editable && (
                    <Link
                      href={`/stories/${story.id}/edit`}
                      className="text-accent underline underline-offset-2"
                    >
                      Edit
                    </Link>
                  )}
                  {awaitingApproval ? (
                    <Link
                      href={`/stories/${story.id}/preview`}
                      className="text-accent underline underline-offset-2"
                    >
                      Review
                    </Link>
                  ) : (
                    <Link
                      href={`/stories/${story.id}/preview`}
                      className="text-foreground/70 underline underline-offset-2"
                    >
                      Preview
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
