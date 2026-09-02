"use client";

import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { StatusBadge } from "./status-badge";
import { StoryCoverThumbnail } from "./story-cover-thumbnail";
import { deleteDraftStoryAction } from "./actions";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ALL, FilterRow } from "@/components/story/filter-row";
import { StartRevisionButton } from "@/components/story/start-revision-button";
import { destinationNames, regionNames } from "@/lib/story/card-fields";
import { EditorialPencilIcon, EyeIcon, TrashIcon } from "@/components/icons";
import type { MyStoryWithCover } from "@/lib/story/contributor-queries";

// Shared 32px round hit-target for every per-story icon action (Edit,
// Preview/Review, Delete and its confirm/cancel step) -- consistent size
// and hover treatment whether the action is a Link or a button.
const ACTION_ICON_CLASS =
  "inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-surface-muted disabled:pointer-events-none disabled:opacity-60";

type ViewMode = "grid" | "list";

const VIEW_STORAGE_KEY = "kaki-my-stories-view";

/**
 * 12 per page. It divides evenly by both grid widths (2 columns on a phone,
 * 3 from `sm`), so a page never ends in a ragged half-row, and it keeps the
 * list view to roughly one screen of scrolling.
 *
 * Paged CLIENT-side, over the stories this page already loaded, because the
 * Region/Destination filter axes above the list are built from the whole set
 * (buildLocationAxes) -- server-side paging would rebuild those chips from
 * whatever 12 stories happened to be on screen, so a filter could vanish
 * just because you turned the page. list_my_stories() returns a single
 * contributor's own stories in one round trip, which is a few dozen rows at
 * the scale this product is for; if that ever stops being true, the RPC
 * needs p_limit/p_offset AND the axes need their own query, together.
 */
const STORIES_PER_PAGE = 12;

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
  // "In review" has two shapes. A FIRST submission moves the whole story to
  // pending_review. An edit to an ALREADY-PUBLISHED story deliberately
  // leaves lifecycle_status = 'published' from submit right through
  // approval -- that is exactly what keeps the live version live
  // (Engineering Rule 11) -- so there it shows up only as a submitted
  // in-flight revision.
  const inReview =
    story.lifecycle_status === "pending_review" ||
    story.draftRevisionStatus === "submitted";
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
  // Nothing is in flight, but there IS something to revise: a published
  // story the contributor wants to correct, or one a moderator sent back
  // asking for changes. Both need a new draft to be created first
  // (create_next_draft_revision()), which is why this is a confirm-then-act
  // button rather than a link. Mirrors that RPC's own preconditions:
  // it refuses a story that already has an in-flight revision, and an
  // archived one.
  const canStartRevision =
    !story.current_draft_revision_id &&
    (story.lifecycle_status === "published" ||
      story.lifecycle_status === "changes_requested");
  // A published story with work in flight keeps its "Published" badge --
  // because it genuinely is still published -- so the in-flight edit needs
  // its own small marker, or the page looks identical either way.
  const updateInFlight =
    story.published_revision_id !== null &&
    Boolean(story.current_draft_revision_id);
  return {
    awaitingApproval,
    editable,
    deletable,
    canStartRevision,
    inReview,
    updateInFlight,
  };
}

/**
 * The marker described above: shown only on a published story that has an
 * edit in flight, saying whether that edit is still the contributor's to
 * work on or is now sitting with a moderator.
 */
function UpdateChip({ inReview }: { inReview: boolean }) {
  return (
    <span className="inline-flex items-center rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-bold text-foreground/65">
      {inReview ? "Update in review" : "Update in progress"}
    </span>
  );
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

// Client-side location filtering over the contributor's already-loaded
// stories -- the same shape as the landing page's catalogue index
// (components/home/story-index.tsx): each axis is built only from values
// present in this list, and an axis earns its row only if it can actually
// split the list (more than one value, or a single value that not every
// story carries), so a chip can never lead to an empty result and a
// do-nothing control is never rendered.
type LocationAxis = {
  key: "region" | "destination";
  label: string;
  read: (story: MyStoryWithCover) => string[];
  options: string[];
};

function buildLocationAxes(stories: MyStoryWithCover[]): LocationAxis[] {
  const defs: Array<Pick<LocationAxis, "key" | "label" | "read">> = [
    { key: "region", label: "Region", read: (s) => regionNames(s.regions) },
    {
      key: "destination",
      label: "Destination",
      read: (s) => destinationNames(s.regions),
    },
  ];

  const axes: LocationAxis[] = [];
  for (const def of defs) {
    const counts = new Map<string, number>();
    for (const story of stories) {
      for (const value of new Set(def.read(story))) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
    }
    const options = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([value]) => value);
    const partitions =
      options.length > 1 ||
      (options.length === 1 && (counts.get(options[0]) ?? 0) < stories.length);
    if (partitions) axes.push({ ...def, options });
  }
  return axes;
}

export function MyStoriesView({ stories }: { stories: MyStoryWithCover[] }) {
  const view = useSyncExternalStore(
    subscribeToView,
    getViewSnapshot,
    getServerViewSnapshot,
  );

  const axes = useMemo(() => buildLocationAxes(stories), [stories]);
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>(
    {},
  );
  const filtered = useMemo(
    () =>
      stories.filter((story) =>
        axes.every((axis) => {
          const value = activeFilters[axis.key];
          return !value || value === ALL || axis.read(story).includes(value);
        }),
      ),
    [stories, axes, activeFilters],
  );
  const isFiltered = axes.some(
    (axis) => activeFilters[axis.key] && activeFilters[axis.key] !== ALL,
  );

  const [page, setPage] = useState(1);
  const listTopRef = useRef<HTMLDivElement>(null);

  const pageCount = Math.max(1, Math.ceil(filtered.length / STORIES_PER_PAGE));
  // Clamped on read rather than corrected in state: applying a filter can
  // shrink the list below the page you are on, and a stored out-of-range
  // page renders an empty screen with no obvious way back. Deriving it also
  // keeps this out of an effect (react-hooks/set-state-in-effect).
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * STORIES_PER_PAGE;
  const visible = filtered.slice(pageStart, pageStart + STORIES_PER_PAGE);

  function goToPage(next: number) {
    setPage(next);
    // The controls sit below the list, so paging without this leaves you
    // looking at the bottom of a page you have not read yet.
    listTopRef.current?.scrollIntoView({ block: "start" });
  }

  // Any change to what is being filtered starts again from page 1 -- page 3
  // of the old result set means nothing in the new one.
  function changeFilter(key: string, value: string) {
    setActiveFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }

  function clearFilters() {
    setActiveFilters({});
    setPage(1);
  }

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
      ) : (
        <>
          {axes.length > 0 && (
            <div className="mt-8 flex flex-col gap-4 border-b border-border-subtle pb-6">
              {axes.map((axis) => (
                <FilterRow
                  key={axis.key}
                  label={axis.label}
                  options={[ALL, ...axis.options]}
                  active={activeFilters[axis.key] ?? ALL}
                  onChange={(value) => changeFilter(axis.key, value)}
                />
              ))}
            </div>
          )}

          {axes.length > 0 && (
            <p
              className="mt-5 font-mono text-xs tracking-wider text-foreground/50 tabular-nums"
              aria-live="polite"
            >
              {filtered.length} {filtered.length === 1 ? "STORY" : "STORIES"}
              {isFiltered ? (
                <>
                  {" · "}
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="underline underline-offset-4 hover:text-accent"
                  >
                    CLEAR
                  </button>
                </>
              ) : null}
            </p>
          )}

          <div ref={listTopRef} className="scroll-mt-4" />

          {filtered.length === 0 ? (
            <p className="mt-8 text-foreground/65">
              No stories match those filters.{" "}
              <button
                type="button"
                onClick={clearFilters}
                className="text-accent underline underline-offset-2"
              >
                Clear filters
              </button>
              .
            </p>
          ) : view === "grid" ? (
            <ul
              className={`grid grid-cols-2 gap-4 sm:grid-cols-3 ${
                axes.length > 0 ? "mt-4" : "mt-8"
              }`}
            >
              {visible.map((story) => {
                const {
                  awaitingApproval,
                  editable,
                  deletable,
                  canStartRevision,
                  inReview,
                  updateInFlight,
                } = storyStatusFlags(story);
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
                      {updateInFlight && (
                        <p className="mt-1">
                          <UpdateChip inReview={inReview} />
                        </p>
                      )}
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
                        {canStartRevision && (
                          <StartRevisionButton
                            storyId={story.id}
                            storyTitle={title}
                            isPublished={story.lifecycle_status === "published"}
                            variant="icon"
                            className={`${ACTION_ICON_CLASS} text-accent`}
                          />
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
            <ul className={axes.length > 0 ? "mt-4" : "mt-8"}>
              {visible.map((story, index) => {
                const {
                  awaitingApproval,
                  editable,
                  deletable,
                  canStartRevision,
                  inReview,
                  updateInFlight,
                } = storyStatusFlags(story);
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
                        {String(pageStart + index + 1).padStart(2, "0")}
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
                            {updateInFlight && (
                              <UpdateChip inReview={inReview} />
                            )}
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
                          {canStartRevision && (
                            <StartRevisionButton
                              storyId={story.id}
                              storyTitle={title}
                              isPublished={
                                story.lifecycle_status === "published"
                              }
                              variant="icon"
                              className={`${ACTION_ICON_CLASS} text-accent`}
                            />
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

          {pageCount > 1 && (
            <nav
              aria-label="Story pages"
              className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle pt-5 text-sm"
            >
              {/* Announced on change: without this, paging is silent to a
                  screen reader -- the list swaps out with nothing said. */}
              <span
                aria-live="polite"
                className="font-mono text-xs text-foreground/50 tabular-nums"
              >
                {pageStart + 1}–{pageStart + visible.length} of{" "}
                {filtered.length}
              </span>
              <div className="flex items-center gap-4">
                {/* Disabled rather than hidden at the ends, so the controls
                    don't jump around under the pointer between pages. */}
                <button
                  type="button"
                  onClick={() => goToPage(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="underline underline-offset-4 hover:text-accent disabled:no-underline disabled:opacity-40 disabled:hover:text-foreground"
                >
                  Previous
                </button>
                <span className="font-mono text-xs text-foreground/50 tabular-nums">
                  {currentPage} / {pageCount}
                </span>
                <button
                  type="button"
                  onClick={() => goToPage(currentPage + 1)}
                  disabled={currentPage === pageCount}
                  className="underline underline-offset-4 hover:text-accent disabled:no-underline disabled:opacity-40 disabled:hover:text-foreground"
                >
                  Next
                </button>
              </div>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
