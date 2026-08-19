"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { StatusBadge } from "./status-badge";
import { StoryCoverThumbnail } from "./story-cover-thumbnail";
import { deleteDraftStoryAction } from "./actions";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EditorialPencilIcon, EyeIcon, TrashIcon } from "@/components/icons";
import type { MyStoryWithCover } from "@/lib/story/contributor-queries";

// Shared 32px round hit-target for every per-story icon action (Edit,
// Preview/Review, Delete and its confirm/cancel step) -- consistent size
// and hover treatment whether the action is a Link or a button.
const ACTION_ICON_CLASS =
  "inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-surface-muted disabled:pointer-events-none disabled:opacity-60";

type ViewMode = "grid" | "list";

const VIEW_STORAGE_KEY = "kaki-my-stories-view";

// Same useSyncExternalStore pattern as components/theme-toggle.tsx: the DOM
// (here, localStorage) is the source of truth, read synchronously rather
// than via a setState-in-effect round trip -- React renders
// getServerSnapshot()'s fixed value on the server and on the client's first
// (hydrating) pass, then transparently swaps to getSnapshot()'s real value
// right after, with no extra render triggered by our own code.
const viewListeners = new Set<() => void>();

// List is the default: only an explicitly stored "grid" preference opts out.
// A contributor with no stored preference (including one whose browser
// blocks localStorage) lands on the list, which is the denser, more
// readable shape for a working catalogue of your own drafts.
function getViewSnapshot(): ViewMode {
  try {
    return localStorage.getItem(VIEW_STORAGE_KEY) === "grid" ? "grid" : "list";
  } catch {
    return "list";
  }
}

function getServerViewSnapshot(): ViewMode {
  return "list";
}

function subscribeToView(listener: () => void) {
  viewListeners.add(listener);
  return () => viewListeners.delete(listener);
}

function setStoredView(next: ViewMode) {
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, next);
  } catch {
    // ignore (private browsing / storage disabled)
  }
  viewListeners.forEach((listener) => listener());
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  return new Date(value).toLocaleDateString("en-NZ", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * A story awaiting THIS contributor's approval still has
 * current_draft_revision_id set (mark_editorial_draft_awaiting_approval()
 * doesn't clear it), but the revision itself is frozen
 * (_revision_is_editable() excludes this lifecycle status), and the same
 * is true while a submitted revision is pending_review -- an "Edit" link
 * in either case would lead to a save that always fails. Show a "Review"
 * CTA for the former, and hide "Edit" entirely for the latter, so a
 * contributor can only ever reach an edit that would actually work.
 */
function storyStatusFlags(story: MyStoryWithCover) {
  const awaitingApproval =
    story.lifecycle_status === "awaiting_contributor_approval";
  const inReview = story.lifecycle_status === "pending_review";
  const editable =
    Boolean(story.current_draft_revision_id) && !awaitingApproval && !inReview;
  // Coarse client-side gate matching delete_draft_story()'s cheap
  // precondition (lifecycle_status = 'draft' and never published) -- the
  // RPC itself is the real safety boundary and additionally requires this
  // story have no prior review history, which isn't visible from
  // list_my_stories()'s columns; a story that fails that finer check surfaces
  // the RPC's specific error via the confirm flow below instead of silently
  // hiding the button.
  const deletable =
    story.lifecycle_status === "draft" && story.published_revision_id === null;
  return { awaitingApproval, editable, deletable };
}

/**
 * Where clicking the story itself (its thumbnail/title, not one of the
 * explicit Edit/Preview/Review icon actions) should go: a plain draft goes
 * straight to editing, anything past that (in review, published, or
 * otherwise) goes to the read-only preview -- matching editable's own
 * "current_draft_revision_id can actually be saved" rule would be more
 * precise, but the simpler "draft vs everything else" split is what was
 * asked for and covers the common case (edit while drafting, read
 * afterward).
 */
function primaryStoryHref(story: MyStoryWithCover): string {
  return story.lifecycle_status === "draft"
    ? `/stories/${story.id}/edit`
    : `/stories/${story.id}/preview`;
}

/**
 * A story action rendered as an icon-only Link -- Edit / Review / Preview.
 * `label` becomes both the visible tooltip (title) and the accessible name
 * (aria-label), since the icon alone carries no text for a screen reader.
 */
function ActionIconLink({
  href,
  label,
  className,
  children,
}: {
  href: string;
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      title={label}
      aria-label={label}
      className={`${ACTION_ICON_CLASS} ${className ?? ""}`}
    >
      {children}
    </Link>
  );
}

/**
 * Delete, gated behind a real confirmation dialog (ConfirmDialog, the same
 * <dialog>-based shell as the sign-in/sign-up modal) rather than a bare
 * click -- deletion is permanent, delete_draft_story() hard-deletes the
 * story row and everything under it (Engineering rule: only ever a
 * never-published, never-submitted draft, so nothing public is at stake).
 */
function DeleteDraftAction({
  story,
  title,
  className,
}: {
  story: MyStoryWithCover;
  title: string;
  className?: string;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleConfirm() {
    setDeleting(true);
    const result = await deleteDraftStoryAction(story.id, story.version);
    if (result.ok) {
      showToast(`"${title}" deleted.`);
      router.refresh();
      return;
    }
    setDeleting(false);
    setConfirmOpen(false);
    showToast(result.error, "error");
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        title={`Delete ${title}`}
        aria-label={`Delete ${title}`}
        className={`${ACTION_ICON_CLASS} text-destructive ${className ?? ""}`}
      >
        <TrashIcon className="h-4 w-4" />
      </button>
      <ConfirmDialog
        open={confirmOpen}
        title="Delete this story?"
        description={`"${title}" will be permanently deleted. This can't be undone.`}
        confirmLabel="Delete story"
        danger
        pending={deleting}
        onConfirm={handleConfirm}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}

function GridIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className="h-4 w-4"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

export function MyStoriesView({ stories }: { stories: MyStoryWithCover[] }) {
  const view = useSyncExternalStore(
    subscribeToView,
    getViewSnapshot,
    getServerViewSnapshot,
  );

  function changeView(next: ViewMode) {
    setStoredView(next);
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="journiq-heading text-[2.4rem]">My Stories</h1>
        <div className="flex items-center gap-3">
          {stories.length > 0 && (
            <div
              role="group"
              aria-label="View"
              className="flex rounded-md border border-border-subtle p-0.5"
            >
              <button
                type="button"
                onClick={() => changeView("grid")}
                aria-pressed={view === "grid"}
                aria-label="Grid view"
                title="Grid view"
                className={`rounded px-2 py-1.5 ${
                  view === "grid"
                    ? "bg-surface-muted text-foreground"
                    : "text-foreground/60 hover:bg-surface-muted/60"
                }`}
              >
                <GridIcon />
              </button>
              <button
                type="button"
                onClick={() => changeView("list")}
                aria-pressed={view === "list"}
                aria-label="List view"
                title="List view"
                className={`rounded px-2 py-1.5 ${
                  view === "list"
                    ? "bg-surface-muted text-foreground"
                    : "text-foreground/60 hover:bg-surface-muted/60"
                }`}
              >
                <ListIcon />
              </button>
            </div>
          )}
          <Link
            href="/stories/new/import"
            className="journiq-button border border-border-subtle bg-transparent text-foreground"
          >
            Import PDF / Canva
          </Link>
          <Link
            href="/stories/new"
            className="journiq-button bg-accent text-accent-foreground"
          >
            New Story
          </Link>
        </div>
      </div>

      {stories.length === 0 ? (
        <p className="mt-8 text-foreground/65">
          You haven&apos;t started a story yet.{" "}
          <Link
            href="/stories/new"
            className="text-accent underline underline-offset-2"
          >
            Start your first one
          </Link>{" "}
          or{" "}
          <Link
            href="/stories/new/import"
            className="text-accent underline underline-offset-2"
          >
            import a PDF/Canva export
          </Link>
          .
        </p>
      ) : view === "grid" ? (
        <ul className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3">
          {stories.map((story) => {
            const { awaitingApproval, editable, deletable } =
              storyStatusFlags(story);
            const title = story.title ?? "Untitled story";
            const href = primaryStoryHref(story);
            return (
              <li key={story.id}>
                <Link
                  href={href}
                  className="relative block aspect-square overflow-hidden rounded-md border border-border-subtle"
                >
                  <StoryCoverThumbnail
                    mediaId={story.coverMediaId}
                    altText={story.coverAltText}
                  />
                  <div className="absolute right-2 top-2 rounded-full bg-surface/90 p-0.5 shadow-sm backdrop-blur-sm">
                    <StatusBadge status={story.lifecycle_status} />
                  </div>
                </Link>
                <div className="mt-2">
                  <p className="truncate text-sm font-medium">{title}</p>
                  <div className="-ml-1.5 mt-1 flex flex-wrap items-center">
                    {editable && (
                      <ActionIconLink
                        href={`/stories/${story.id}/edit`}
                        label={`Edit ${title}`}
                        className="text-accent"
                      >
                        <EditorialPencilIcon className="h-4 w-4" />
                      </ActionIconLink>
                    )}
                    {awaitingApproval ? (
                      <ActionIconLink
                        href={`/stories/${story.id}/preview`}
                        label={`Review ${title}`}
                        className="text-accent"
                      >
                        <EyeIcon className="h-4 w-4" />
                      </ActionIconLink>
                    ) : (
                      <ActionIconLink
                        href={`/stories/${story.id}/preview`}
                        label={`Preview ${title}`}
                        className="text-foreground/70"
                      >
                        <EyeIcon className="h-4 w-4" />
                      </ActionIconLink>
                    )}
                    {deletable && (
                      <DeleteDraftAction story={story} title={title} />
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        // Styled after the landing page's catalogue index
        // (components/home/story-index.tsx): hairline-ruled rows (.nf-entry),
        // a mono tabular numeral, and a cover thumbnail beside the title.
        // Unlike that index, a row here can't be one big <Link> -- each story
        // carries its own Edit/Preview actions -- so the thumbnail and title
        // are the linked targets and the actions sit alongside.
        <ul className="mt-8">
          {stories.map((story, index) => {
            const { awaitingApproval, editable, deletable } =
              storyStatusFlags(story);
            const updated = formatDate(story.updated_at);
            const title = story.title ?? "Untitled story";
            const href = primaryStoryHref(story);
            return (
              <li key={story.id} className="nf-entry">
                {/* One grid, two shapes. Mobile: [thumb | stacked content],
                    numeral hidden (display:none claims no track). From sm up
                    the inner wrapper becomes `display: contents` so its
                    children drop into the parent grid as real columns
                    [numeral | thumb | title+meta | actions]. */}
                <div className="grid grid-cols-[4rem_minmax(0,1fr)] items-start gap-x-3 py-4 sm:grid-cols-[2.5rem_5rem_minmax(0,1fr)_auto] sm:items-center sm:gap-x-5">
                  <span
                    aria-hidden="true"
                    className="hidden font-mono text-sm text-foreground/40 tabular-nums sm:block"
                  >
                    {String(index + 1).padStart(2, "0")}
                  </span>

                  <Link
                    href={href}
                    tabIndex={-1}
                    aria-hidden="true"
                    className="block h-12 w-16 overflow-hidden rounded-md border border-border-subtle bg-surface-muted sm:h-14 sm:w-20"
                  >
                    <StoryCoverThumbnail
                      mediaId={story.coverMediaId}
                      altText={null}
                    />
                  </Link>

                  <div className="sm:contents">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={href}
                          className="font-medium hover:text-accent hover:underline underline-offset-2"
                        >
                          {title}
                        </Link>
                        <StatusBadge status={story.lifecycle_status} />
                      </div>
                      {story.excerpt && (
                        <p className="mt-1 line-clamp-2 text-sm text-foreground/70">
                          {story.excerpt}
                        </p>
                      )}
                      {updated && (
                        <p className="mt-1 font-mono text-xs text-foreground/45 tabular-nums">
                          Updated {updated}
                        </p>
                      )}
                    </div>

                    <div className="-ml-1.5 mt-1 flex items-center sm:mt-0">
                      {editable && (
                        <ActionIconLink
                          href={`/stories/${story.id}/edit`}
                          label={`Edit ${title}`}
                          className="text-accent"
                        >
                          <EditorialPencilIcon className="h-4 w-4" />
                        </ActionIconLink>
                      )}
                      {awaitingApproval ? (
                        <ActionIconLink
                          href={`/stories/${story.id}/preview`}
                          label={`Review ${title}`}
                          className="text-accent"
                        >
                          <EyeIcon className="h-4 w-4" />
                        </ActionIconLink>
                      ) : (
                        <ActionIconLink
                          href={`/stories/${story.id}/preview`}
                          label={`Preview ${title}`}
                          className="text-foreground/70"
                        >
                          <EyeIcon className="h-4 w-4" />
                        </ActionIconLink>
                      )}
                      {deletable && (
                        <DeleteDraftAction story={story} title={title} />
                      )}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
