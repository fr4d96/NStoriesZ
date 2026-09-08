"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { StatusBadge } from "./status-badge";
import { StoryCoverThumbnail } from "./story-cover-thumbnail";
import {
  deleteDraftStoryAction,
  requestStoryTakedownAction,
  cancelStoryTakedownAction,
} from "./actions";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ALL, FilterRow } from "@/components/story/filter-row";
import { StartRevisionButton } from "@/components/story/start-revision-button";
import {
  destinationNames,
  regionNames,
  stringList,
} from "@/lib/story/card-fields";
import { isPrivateStory } from "@/lib/story/story-visibility";
import {
  ChevronIcon,
  EditorialPencilIcon,
  EyeIcon,
  HiddenEyeIcon,
  TrashIcon,
} from "@/components/icons";
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
 * Region/Destination/Tags filter axes above the list are built from the whole
 * set (buildFilterAxes) -- server-side paging would rebuild those chips from
 * whatever 12 stories happened to be on screen, so a filter could vanish
 * just because you turned the page. list_my_stories() returns a single
 * contributor's own stories in one round trip, which is a few dozen rows at
 * the scale this product is for; if that ever stops being true, the RPC
 * needs p_limit/p_offset AND the axes need their own query, together.
 */

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
 * Which collapsible section a story belongs to on My Stories.
 *
 * Exhaustive over story_lifecycle_status' eight values, and deliberately
 * checked in this order:
 *
 *  - `published` FIRST, so a live story with an edit in flight stays under
 *    Published. Its `draftRevisionStatus` is 'submitted', which would
 *    otherwise pull it into "In review" and make a story readers can see
 *    right now vanish from the section that says so. The in-flight edit is
 *    already marked on the row by <UpdateChip>, which is the right place for
 *    a sub-state (Engineering Rule 11: the published version stays live
 *    throughout its update's review).
 *  - `review` is the whole-story review states -- a first submission waiting
 *    on a moderator, or an editorial draft waiting on the contributor.
 *  - `drafts` is what the contributor can still edit: a new draft, or one a
 *    moderator sent back.
 *  - `private` is a story the contributor finished and chose to keep to
 *    themselves (20260907100100_private_stories.sql). It needs its own
 *    section for the same reason `closed` does, in the opposite direction:
 *    it is neither work in progress nor a failure, and the fall-through
 *    below would otherwise file it under "Not published — archived or not
 *    approved", which reads as something having gone wrong rather than as
 *    the deliberate choice it was.
 *  - `closed` is everything terminal. It has its own section rather than
 *    being folded into Drafts, because "not approved" and "archived" are not
 *    work in progress and grouping them there would imply they are.
 */
export type StorySection =
  "drafts" | "review" | "published" | "private" | "closed";

export function storySection(story: MyStoryWithCover): StorySection {
  if (story.lifecycle_status === "published") return "published";
  if (
    story.lifecycle_status === "pending_review" ||
    story.lifecycle_status === "awaiting_contributor_approval"
  ) {
    return "review";
  }
  if (isPrivateStory(story.lifecycle_status)) return "private";
  if (
    story.lifecycle_status === "draft" ||
    story.lifecycle_status === "changes_requested"
  ) {
    return "drafts";
  }
  return "closed";
}

/**
 * Section order is the contributor's own workflow, not the enum's: what you
 * are still writing, then what someone else is holding, then what is live,
 * then what is over. Each carries a plain-language hint because "In review"
 * alone does not say who is waiting on whom.
 */
const SECTIONS: {
  key: StorySection;
  label: string;
  hint: string;
}[] = [
  { key: "drafts", label: "Drafts", hint: "Yours to finish" },
  { key: "review", label: "In review", hint: "Waiting on a moderator" },
  { key: "published", label: "Published", hint: "Readers can see these" },
  // Beside Published rather than beside Drafts: both are finished stories
  // that came out the way the contributor wanted. Only the terminal states
  // sit after them.
  { key: "private", label: "Private", hint: "Only you can see these" },
  { key: "closed", label: "Not published", hint: "Archived or not approved" },
];

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
  // precondition (lifecycle_status 'draft' or 'private', and never
  // published) -- the RPC itself is the real safety boundary and
  // additionally requires this story have no prior review history, which
  // isn't visible from list_my_stories()'s columns; a story that fails that
  // finer check surfaces the RPC's specific error via the confirm flow
  // below instead of silently hiding the button.
  //
  // 'private' belongs here for the same reason 'draft' does, and leaving it
  // out would have been a quiet regression: nothing about a private story
  // is public or reviewed, so choosing "keep this to myself" must not also
  // take away the ability to throw it away. delete_draft_story() was
  // widened to match in 20260907100100_private_stories.sql.
  const deletable =
    (story.lifecycle_status === "draft" ||
      isPrivateStory(story.lifecycle_status)) &&
    story.published_revision_id === null;
  // Withdrawal ("Take down") is the OTHER destructive action, and the
  // opposite case to deletable above: a story that is live to the public
  // right now. revoke_publication_consent() only has anything to do on a
  // published story (it archives one; on anything else it would just set a
  // terminal consent flag on content nobody can see), and it is terminal --
  // no function ever grants consent again, so this is deliberately not
  // offered anywhere the contributor could reach it by accident. The two
  // can never appear together: deletable requires lifecycle 'draft' and no
  // published revision, which is exactly what this excludes.
  const withdrawable = story.lifecycle_status === "published";
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
    withdrawable,
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

/** One row of list_my_takedown_requests(), as the page hands it over. */
export type TakedownRequestRow = {
  request_id: string;
  story_id: string;
  status: string;
  requested_at: string;
  decided_at: string | null;
  decision_note: string | null;
};

/**
 * "Take down" — the contributor ASKS for a story that is live right now to
 * be removed (docs/content-governance.md, "Corrections, withdrawal, and
 * deletion"). Sits beside DeleteDraftAction above and is deliberately NOT
 * the same control:
 *
 *   - Delete applies to a never-published draft, and destroys it, now.
 *   - Take down applies to a PUBLISHED story, asks a moderator, and destroys
 *     nothing; the writing and images stay in the contributor's account.
 *
 * The honest part, which the copy leads with rather than buries: the story
 * STAYS PUBLIC until someone reviews the request. A contributor who has just
 * asked for their story to come down will reasonably assume it is already
 * gone, and it is not. Saying so plainly is the difference between a queue
 * and a broken promise.
 *
 * No reason is asked for. Taking your own story down is your call, not one
 * you owe an explanation for -- the optional note is framed as context for
 * whoever picks it up, and the RPC accepts null.
 */
function TakedownAction({
  story,
  title,
  request,
  className,
}: {
  story: MyStoryWithCover;
  title: string;
  request: TakedownRequestRow | null;
  className?: string;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const awaitingReview = request?.status === "pending";

  async function handleRequest() {
    setPending(true);
    const result = await requestStoryTakedownAction(story.id, story.version);
    if (result.ok) {
      showToast(
        `Asked for "${title}" to be taken down. It stays public until the team reviews it.`,
      );
      router.refresh();
      return;
    }
    setPending(false);
    setConfirmOpen(false);
    showToast(result.error, "error");
  }

  async function handleCancel() {
    if (!request) return;
    setPending(true);
    const result = await cancelStoryTakedownAction(request.request_id);
    if (result.ok) {
      showToast(`"${title}" stays up — request withdrawn.`);
      router.refresh();
      return;
    }
    setPending(false);
    setCancelOpen(false);
    showToast(result.error, "error");
  }

  if (awaitingReview) {
    return (
      <>
        <button
          type="button"
          onClick={() => setCancelOpen(true)}
          title={`Takedown requested for ${title} — awaiting review. Choose to cancel the request.`}
          aria-label={`Cancel the takedown request for ${title}`}
          className={`${ACTION_ICON_CLASS} text-muted-foreground ${className ?? ""}`}
        >
          <HiddenEyeIcon className="h-4 w-4" />
        </button>
        <ConfirmDialog
          open={cancelOpen}
          title="Keep this story up?"
          description={`You asked for "${title}" to be taken down and nobody has reviewed it yet. Cancelling leaves the story published, exactly as it is now. You can ask again at any time.`}
          confirmLabel="Cancel the request"
          pending={pending}
          onConfirm={handleCancel}
          onCancel={() => setCancelOpen(false)}
        />
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        title={`Take down ${title}`}
        aria-label={`Take down ${title}`}
        className={`${ACTION_ICON_CLASS} text-destructive ${className ?? ""}`}
      >
        <HiddenEyeIcon className="h-4 w-4" />
      </button>
      <ConfirmDialog
        open={confirmOpen}
        title="Ask for this story to be taken down?"
        description={`The Kakinotes team reviews the request, and "${title}" stays public until they do. Nothing is deleted either way — your writing and photos stay in your account. If you only want to change something, use Edit instead: your story stays up while the change is reviewed.`}
        confirmLabel="Ask for takedown"
        danger
        pending={pending}
        onConfirm={handleRequest}
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

// Client-side filtering over the contributor's already-loaded stories --
// the same shape as the landing page's catalogue index
// (components/home/story-index.tsx): each axis is built only from values
// present in this list, and an axis earns its row only if it can actually
// split the list (more than one value, or a single value that not every
// story carries), so a chip can never lead to an empty result and a
// do-nothing control is never rendered.
//
// That "earns its row" rule is why adding an axis is cheap: a contributor
// who has never tagged anything simply does not get a Tags row.
type FilterAxis = {
  key: "region" | "destination" | "tag";
  label: string;
  read: (story: MyStoryWithCover) => string[];
  options: string[];
};

function buildFilterAxes(stories: MyStoryWithCover[]): FilterAxis[] {
  const defs: Array<Pick<FilterAxis, "key" | "label" | "read">> = [
    { key: "region", label: "Region", read: (s) => regionNames(s.regions) },
    {
      key: "destination",
      label: "Destination",
      read: (s) => destinationNames(s.regions),
    },
    // list_my_stories()'s `tags` is already a flat array of resolved names
    // (20260907110000), each one either a `tags` lookup row's name or the
    // label the contributor typed themselves -- so a self-authored tag
    // filters exactly like a seeded one, which on this product is most of
    // them.
    { key: "tag", label: "Tags", read: (s) => stringList(s.tags) },
  ];

  const axes: FilterAxis[] = [];
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

/**
 * The square-cover grid, for one section's stories. Extracted from the page
 * body when My Stories gained collapsible status sections -- both views now
 * render once per section instead of once for the whole list.
 */
function StoryGrid({
  stories,
  takedownByStory,
}: {
  stories: MyStoryWithCover[];
  takedownByStory: Map<string, TakedownRequestRow>;
}) {
  return (
    <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
      {stories.map((story) => {
        const {
          awaitingApproval,
          editable,
          deletable,
          withdrawable,
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
              {/* An OPAQUE pill exactly the badge's own size. Two things were
                  wrong before: `p-0.5` drew a 2px ring of plain surface
                  around the tinted badge, reading as a grey halo, and
                  `bg-surface/90` let the photo through -- so a badge whose
                  own fill is only a 15% tint (bg-fern/15 for Published) went
                  muddy and lost its contrast over a busy cover.
                  `bg-background`, not `bg-surface`, because that is what the
                  same badge sits on in the list view, so the composited
                  colour matches between the two views.

                  `flex` is load-bearing too: the badge is inline-flex, so a
                  block wrapper adds ~4px of line-box leading around it and
                  the rounded wrapper ends up a taller pill than the badge --
                  a faint halo again, in a different disguise. */}
              <div className="absolute right-2 top-2 flex rounded-full bg-background shadow-sm">
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
                {deletable && <DeleteDraftAction story={story} title={title} />}
                {withdrawable && (
                  <TakedownAction
                    story={story}
                    title={title}
                    request={takedownByStory.get(story.id) ?? null}
                  />
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The ruled-row list, for one section's stories. Styled after the landing
 * page's catalogue index (components/home/story-index.tsx): hairline-ruled
 * rows (.nf-entry), a mono tabular numeral, and a cover thumbnail beside the
 * title. Unlike that index, a row here can't be one big <Link> -- each story
 * carries its own Edit/Preview actions -- so the thumbnail and title are the
 * linked targets and the actions sit alongside.
 *
 * The numeral counts within the section, not across the page: sections
 * collapse independently, so a continuous run would renumber every row below
 * whenever one folded.
 */
function StoryList({
  stories,
  takedownByStory,
}: {
  stories: MyStoryWithCover[];
  takedownByStory: Map<string, TakedownRequestRow>;
}) {
  return (
    <ul>
      {stories.map((story, index) => {
        const {
          awaitingApproval,
          editable,
          deletable,
          withdrawable,
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
                    {updateInFlight && <UpdateChip inReview={inReview} />}
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
                  {withdrawable && (
                    <TakedownAction
                      story={story}
                      title={title}
                      request={takedownByStory.get(story.id) ?? null}
                    />
                  )}
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function MyStoriesView({
  stories,
  takedownRequests = [],
}: {
  stories: MyStoryWithCover[];
  takedownRequests?: TakedownRequestRow[];
}) {
  // Keyed once here rather than scanned per row: the list pages twelve at a
  // time and every row asks this question.
  const takedownByStory = useMemo(
    () => new Map(takedownRequests.map((r) => [r.story_id, r])),
    [takedownRequests],
  );
  const view = useSyncExternalStore(
    subscribeToView,
    getViewSnapshot,
    getServerViewSnapshot,
  );

  const axes = useMemo(() => buildFilterAxes(stories), [stories]);
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

  // Grouped from the FILTERED set, so a section's count always matches what
  // its rows would show. Sections replaced the twelve-per-page pager that
  // used to live here: paging across groups is incoherent (a section can be
  // empty on page 2 and full on page 1), and collapsing a group you are not
  // working on controls length better than paging ever did at this
  // product's scale.
  const grouped = useMemo(() => {
    const buckets: Record<StorySection, MyStoryWithCover[]> = {
      drafts: [],
      review: [],
      published: [],
      private: [],
      closed: [],
    };
    for (const story of filtered) buckets[storySection(story)].push(story);
    return buckets;
  }, [filtered]);

  // Tracks what is CLOSED rather than what is open, so a section added later
  // is never accidentally hidden by a stale key.
  //
  // Drafts starts collapsed on purpose: it is the pile that grows without
  // bound -- every abandoned start stays there forever -- so leaving it open
  // pushes Published, the section a contributor actually wants to see, below
  // the fold. The count in its header still says how many are inside, so
  // nothing is hidden, only folded.
  //
  // Component state, like the filters above it, and deliberately not
  // persisted: a reload returns to this same known layout instead of
  // whatever someone left open three visits ago. (The grid/list toggle IS
  // persisted; that is a preference, this is a starting position.)
  const [closedSections, setClosedSections] = useState<
    Partial<Record<StorySection, boolean>>
  >({ drafts: true });

  function toggleSection(key: StorySection, open: boolean) {
    setClosedSections((current) => ({ ...current, [key]: !open }));
  }

  // Any change to what is being filtered starts again from page 1 -- page 3
  // of the old result set means nothing in the new one.
  function changeFilter(key: string, value: string) {
    setActiveFilters((current) => ({ ...current, [key]: value }));
  }

  function clearFilters() {
    setActiveFilters({});
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
            Import
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
            import a PDF
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
          ) : (
            <div className={axes.length > 0 ? "mt-4" : "mt-8"}>
              {SECTIONS.map(({ key, label, hint }) => {
                const rows = grouped[key];
                // An empty section is not drawn at all. A contributor who has
                // never had anything rejected should not be told so.
                if (rows.length === 0) return null;
                const open = !closedSections[key];
                return (
                  <details
                    key={key}
                    open={open}
                    onToggle={(event) =>
                      toggleSection(key, event.currentTarget.open)
                    }
                    className="border-b border-border-subtle last:border-b-0"
                    // <details> exposes role="group", whose accessible name
                    // comes from aria-label -- NOT from <summary>, which is
                    // the disclosure control and names itself. Without this
                    // a screen reader announces four unnamed groups.
                    aria-label={label}
                  >
                    {/* Native <details>/<summary>: the disclosure keyboard
                        behaviour, the expanded/collapsed state and the
                        screen-reader announcement all come free and correct,
                        which a hand-rolled button + aria-expanded would have
                        to reproduce (Engineering Rule 19). The default
                        triangle is hidden two ways because one is not enough:
                        `list-none` covers Firefox and Chrome, the
                        ::-webkit-details-marker variant covers Safari. */}
                    <summary className="flex cursor-pointer list-none items-center gap-3 py-4 outline-offset-4 [&::-webkit-details-marker]:hidden">
                      <ChevronIcon
                        className={`h-4 w-4 shrink-0 text-foreground/40 transition-transform ${
                          open ? "rotate-90" : ""
                        }`}
                      />
                      {/* Plain sans, the app's own sub-heading step
                          (text-lg font-semibold tracking-tight, as used
                          throughout /moderation). This deliberately does NOT
                          set Georgia: app/globals.css records that serif as
                          belonging to the retired Field Journal palette, and
                          .journiq-heading -- the "My Stories" title right
                          above these -- is heavy sans. A serif here was the
                          only serif on the page. */}
                      <span className="text-lg font-semibold tracking-tight">
                        {label}
                      </span>
                      <span className="font-mono text-xs text-foreground/45 tabular-nums">
                        {rows.length}
                      </span>
                      <span className="ml-auto hidden text-sm text-foreground/45 sm:block">
                        {hint}
                      </span>
                    </summary>
                    <div className="pb-6">
                      {view === "grid" ? (
                        <StoryGrid
                          stories={rows}
                          takedownByStory={takedownByStory}
                        />
                      ) : (
                        <StoryList
                          stories={rows}
                          takedownByStory={takedownByStory}
                        />
                      )}
                    </div>
                  </details>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
