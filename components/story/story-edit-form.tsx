"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  revisionInputSchema,
  travelStyles,
  imageBlockMediaIds,
  markdownToStoryContent,
  storyContentText,
  type StoryContentBlock,
} from "@/lib/validation/story";
import { removeMediaEmbeds } from "@/lib/story/markdown-media";
import {
  StoryContentEditor,
  type StoryContentEditorHandle,
} from "@/components/story/story-content-editor";
import { ImageUploadManager } from "@/components/story/image-upload-manager";
import { ContentImportPanel } from "@/components/story/content-import-panel";
import {
  LocationSearch,
  type LocationMatch,
} from "@/components/story/location-search";
import { MutationQueue } from "@/lib/story/mutation-queue";
import { getErrorMessage } from "@/lib/errors";
import type {
  RevisionMediaItem,
  RevisionTagSelection,
} from "@/lib/story/contributor-queries";
import type {
  ActiveRegion,
  ActiveDestination,
  ActiveTag,
} from "@/lib/story/active-lookups";
import {
  saveRevisionFieldsAction,
  setLocationsAction,
  setTagsAction,
} from "@/app/(contributor)/stories/[id]/edit/actions";
import { TagEditor } from "@/components/story/tag-editor";
import { TripDateField } from "@/components/story/trip-date-field";
import { StoryStepProgress } from "@/components/story/story-steps";
import {
  STORY_STEPS,
  missingStoryRequirements,
  type StoryStepId,
} from "@/lib/story/steps";

export type StoryEditFormProps = {
  storyId: string;
  revisionId: string;
  initialVersion: number;
  initialTitle: string;
  initialExcerpt: string;
  initialContentJson: StoryContentBlock[];
  initialTripStartDate: string | null;
  initialTripEndDate: string | null;
  initialTripYear: number | null;
  initialTravelStyle: string | null;
  initialTotalExpenseNzdCents: number | null;
  initialContributorNote: string;
  initialLocations: Array<{
    regionId: string;
    destinationId: string | null;
    sortOrder: number;
  }>;
  initialTags: RevisionTagSelection[];
  initialMedia: RevisionMediaItem[];
  regions: ActiveRegion[];
  destinations: ActiveDestination[];
  /** Suggestions only -- a contributor may add any label they like. */
  tags: ActiveTag[];
  /**
   * Editorial-only addition (Prompt 4 Sub-phase 4): shows the paste/convert
   * content-import panel above the rich text editor. Omitted (falsy) by
   * every self-service call site, which is what keeps this component's
   * existing self-service behavior completely unchanged -- the import
   * panel and its mutation-queue integration only exist when a caller
   * explicitly opts in.
   */
  showContentImport?: boolean;
  /**
   * True only for a story's very first revision (revision_number === 1,
   * the self-service edit page's own signal) -- heads the page "New Story"
   * instead of "Edit Story" for the moment right after /stories/new
   * redirects here, since seeing "Edit Story" on a draft you just clicked
   * "Start writing" on read as a mismatch. Once the story has gone through
   * a submit/changes-requested/resubmit cycle (revision_number > 1), or
   * for the editorial import page (which never passes this at all -- an
   * editor preparing someone else's story is always "editing", never
   * "creating their own new story"), it's "Edit Story" as before.
   */
  isNewStory?: boolean;
  /**
   * Which step of the timeline to open on -- the edit page reads it from
   * `?step=`, which is how the preview page (step 6) sends a contributor
   * back to the exact step they need to fix. Anything unrecognised falls
   * back to the first step, so a hand-typed URL can never land on nothing.
   */
  initialStep?: StoryStepId;
};

const FIELDS_SAVE_DEBOUNCE_MS = 600;

/**
 * The Images section's anchor. The editor's slash-menu "Photo" entry and
 * its toolbar image button both call focusImagesPanel() below rather than
 * uploading anything themselves -- image-upload-manager.tsx owns the whole
 * reservation / direct-to-storage / embed-token flow, and duplicating it
 * inside the editor is the change docs/editor-competitive-research.md
 * deliberately deferred.
 */
const IMAGES_PANEL_ID = "story-images";

/** See the StoryStepProgress call below. Module-level so it is one stable array. */
const REVIEW_STEP_LOCK: StoryStepId[] = ["review"];

/** Ties the disabled "Review & submit" button to the reason it is disabled. */
const MISSING_REQUIREMENTS_ID = "story-missing-requirements";

function focusImagesPanel() {
  const section = document.getElementById(IMAGES_PANEL_ID);
  if (!section) return;
  section.scrollIntoView({ behavior: "smooth", block: "start" });
  // Moves keyboard AND screen-reader focus, not just the viewport -- a
  // scroll alone would leave a keyboard user's focus back in the editor.
  section.focus({ preventScroll: true });
}

/**
 * One step of the timeline. Always mounted; hidden with a class when it is
 * not the current step. Defined at module scope, NOT inside the form's
 * render -- a component created during render is a new component type on
 * every render, so React would unmount and remount its whole subtree on
 * each keystroke, tearing down the uncontrolled rich text editor and any
 * in-flight image upload with it. (The React Compiler's
 * "Cannot create components during render" rule caught exactly this.)
 */
function StepSection({
  id,
  activeStep,
  children,
}: {
  id: StoryStepId;
  activeStep: StoryStepId;
  children: React.ReactNode;
}) {
  return (
    <section
      id={`story-step-${id}`}
      aria-label={STORY_STEPS.find((s) => s.id === id)?.label}
      className={`space-y-6 ${activeStep === id ? "" : "hidden"}`}
    >
      {children}
    </section>
  );
}

/** "midRange" -> "Mid range" -- for displaying camelCase enum values. */
function formatCamelCaseLabel(value: string): string {
  const spaced = value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Visual + a11y marker for a required field label -- title, story content,
 * locations, and tags (see the preview page's `missingRequirements` gate,
 * which is where these are actually enforced; this form never blocks
 * autosave itself on them, since a contributor fills them in incrementally).
 * `aria-hidden` on the glyph plus a visually-hidden "required" is the usual
 * pattern -- a screen reader shouldn't read a bare "asterisk".
 */
function RequiredMark() {
  return (
    <span className="text-destructive">
      <span aria-hidden="true"> *</span>
      <span className="sr-only"> required</span>
    </span>
  );
}

/**
 * Ambient autosave status, replacing the "Draft saved." toast that used to
 * fire on every debounced field save.
 *
 * Three things this fixes. It no longer claims "Saved" on a draft that has
 * not been saved this session (the old line was a bare ternary, so an
 * untouched form read as freshly saved). It says WHEN, because "Saved" with
 * no time is exactly as reassuring as nothing at all once you have been
 * typing for a while. And its aria-live region is `off` while idle and only
 * announces on the transition into a settled state, so a screen reader is
 * told "Saved" once after you stop typing, rather than on every pause.
 *
 * The relative time re-renders on a 30s interval, but ONLY while a save has
 * actually happened -- no timer runs on a form nobody has edited.
 */
function relativeSaveTime(from: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - from) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

function SaveStatus({
  saving,
  lastSavedAt,
}: {
  saving: boolean;
  lastSavedAt: number | null;
}) {
  const [now, setNow] = useState(() => Date.now());

  // No synchronous setState here: a fresh stamp makes `now` at most one
  // tick stale, and relativeSaveTime() floors at 0, so the label reads
  // "just now" either way. The interval is the only writer.
  useEffect(() => {
    if (lastSavedAt === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [lastSavedAt]);

  const label = saving
    ? "Saving…"
    : lastSavedAt !== null
      ? `Saved ${relativeSaveTime(lastSavedAt, now)}`
      : "Not saved yet";

  return (
    <span
      className="flex items-center gap-2 text-muted-foreground tabular-nums"
      // Announce the settled result, not every keystroke's "Saving…".
      aria-live={saving ? "off" : "polite"}
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 shrink-0 rounded-full transition-colors duration-300 ${
          saving
            ? "animate-pulse bg-accent"
            : lastSavedAt !== null
              ? "bg-accent/45"
              : "bg-border-subtle"
        }`}
      />
      {label}
    </span>
  );
}

export function StoryEditForm({
  storyId,
  revisionId,
  initialVersion,
  initialTitle,
  initialExcerpt,
  initialContentJson,
  initialTripStartDate,
  initialTripEndDate,
  initialTripYear,
  initialTravelStyle,
  initialTotalExpenseNzdCents,
  initialContributorNote,
  initialLocations,
  initialTags,
  initialMedia,
  regions,
  destinations,
  tags,
  showContentImport,
  isNewStory = false,
  initialStep = "title",
}: StoryEditFormProps) {
  const versionRef = useRef(initialVersion);
  const [conflict, setConflict] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [, forceRerender] = useState(0);

  // When a mutation last actually landed. Drives the status line below.
  // Null until the first successful save of this session, so a freshly
  // opened draft does not claim to have just saved something. Stamped from
  // each mutation's own success branch rather than from the queue's
  // onSettled: onSettled runs inside the useMemo factory that builds the
  // queue, which React treats as render phase, and both reading a ref and
  // calling Date.now() there are render-phase violations the compiler
  // rejects outright. The success branches are ordinary async callbacks.
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  const queue = useMemo(() => {
    const q = new MutationQueue({
      onVersionConflict: () => setConflict(true),
      onError: (_slot, error) =>
        setSaveError(getErrorMessage(error, "Save failed.")),
      // `saving` must stay true whenever ANY mutation is queued or running
      // across ANY slot -- not merely "the mutation that just settled did."
      // Reading queue.hasPending() at the moment of settling (rather than
      // hardcoding false) is what keeps the indicator correct across the
      // gap between one slot's mutation finishing and a still-pending
      // different slot's mutation starting. See
      // lib/story/mutation-queue.test.ts's "R6-7" describe block for the
      // regression test on the underlying primitive.
      onSettled: () => setSaving(q.hasPending()),
    });
    return q;
  }, []);

  function bumpVersion() {
    forceRerender((n) => n + 1);
  }

  const [title, setTitle] = useState(initialTitle);
  const [excerpt, setExcerpt] = useState(initialExcerpt);
  const [content, setContent] =
    useState<StoryContentBlock[]>(initialContentJson);
  const inlineMediaIds = useMemo(
    () => new Set(imageBlockMediaIds(content)),
    [content],
  );
  const [dateMode, setDateMode] = useState<"range" | "year">(
    initialTripYear ? "year" : "range",
  );
  const [tripStartDate, setTripStartDate] = useState(
    initialTripStartDate ?? "",
  );
  const [tripEndDate, setTripEndDate] = useState(initialTripEndDate ?? "");
  const [tripYear, setTripYear] = useState(
    initialTripYear ? String(initialTripYear) : "",
  );
  const [travelStyle, setTravelStyle] = useState(initialTravelStyle ?? "");
  // travel_style is a loosely-typed `text` column (no DB enum/CHECK --
  // confirmed by reading supabase/migrations/20260803090200_story_revisions.sql
  // before relying on it), so a contributor's own wording is just as valid
  // a value as the three curated presets -- "other" here is a UI-only mode,
  // never itself a stored value. Detects an existing custom value on load
  // (e.g. from an earlier session) so re-opening the form doesn't silently
  // drop it into "Not specified".
  const [travelStyleMode, setTravelStyleMode] = useState<"preset" | "other">(
    initialTravelStyle &&
      !(travelStyles as readonly string[]).includes(initialTravelStyle)
      ? "other"
      : "preset",
  );
  const [expenseDollars, setExpenseDollars] = useState(
    initialTotalExpenseNzdCents != null
      ? String(initialTotalExpenseNzdCents / 100)
      : "",
  );
  const [contributorNote, setContributorNote] = useState(
    initialContributorNote,
  );
  const [locations, setLocations] = useState(initialLocations);
  const [locationSearchNotice, setLocationSearchNotice] = useState<
    string | null
  >(null);
  const [selectedTags, setSelectedTags] =
    useState<RevisionTagSelection[]>(initialTags);

  // Which step of the timeline is on screen. Every step's section is
  // rendered and stays MOUNTED -- inactive ones are hidden with a class,
  // never conditionally rendered. That is load-bearing, not a style
  // preference: the rich text editor is uncontrolled (see
  // story-content-editor.tsx), so unmounting its step would throw away the
  // visible document and all of its undo history, and the image panel
  // would drop any upload still in flight.
  const [step, setStep] = useState<StoryStepId>(initialStep);
  const stepIndex = STORY_STEPS.findIndex((s) => s.id === step);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  // Set only by goToStep(), so the focus effect below fires on a real step
  // change and never on the initial render (which would rip focus off the
  // page the moment the editor loads).
  const stepChangedRef = useRef(false);

  function goToStep(next: StoryStepId) {
    if (next === step) return;
    stepChangedRef.current = true;
    setStep(next);
  }

  // A step change is a navigation: the new step's heading takes focus so a
  // screen reader announces where it landed and a keyboard user's next Tab
  // starts inside the new step, not wherever the old one left off.
  // `scrollTo` rather than scrollIntoView -- the sticky action bar would
  // otherwise sit over the heading it just focused.
  //
  // `behavior: "instant"`, NOT "smooth", and the distinction is load-bearing
  // rather than taste. app/globals.css sets `scroll-behavior: smooth` on
  // <html>, so a plain scrollTo animates too; any animated scroll is
  // cancellable, and the browser cancels it the moment something else moves
  // focus or the layout. That is exactly what "Add to story" does one frame
  // later -- it switches to this step and then inserts into the editor --
  // so the scroll to the top was being abandoned partway and the page came
  // to rest with the editor mostly above the viewport. "instant" also
  // overrides the CSS rule, which "auto" would not.
  useEffect(() => {
    if (!stepChangedRef.current) return;
    stepChangedRef.current = false;
    window.scrollTo({ top: 0, behavior: "instant" });
    stepHeadingRef.current?.focus({ preventScroll: true });
  }, [step]);

  const debounceHandle = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Synchronous ref, not just React state -- checked from inside the
  // debounce timer's callback (a plain closure, not a re-render), so a
  // keystroke-triggered autosave scheduled just before an import-apply
  // starts can never fire during it and race the destructive replace.
  // React state (applyingImport, below) exists only to drive UI disabling.
  const applyingImportRef = useRef(false);
  const [applyingImport, setApplyingImport] = useState(false);
  const richTextEditorRef = useRef<StoryContentEditorHandle>(null);

  const queueFieldsSave = useCallback(
    (next: {
      title: string;
      excerpt: string;
      content: StoryContentBlock[];
      dateMode: "range" | "year";
      tripStartDate: string;
      tripEndDate: string;
      tripYear: string;
      travelStyle: string;
      expenseDollars: string;
      contributorNote: string;
    }) => {
      if (debounceHandle.current) clearTimeout(debounceHandle.current);
      setSaving(true);
      debounceHandle.current = setTimeout(() => {
        // An import-apply is in progress -- it owns the "fields" slot for
        // its own destructive replace; a stale keystroke-triggered autosave
        // from just before the import started must become a no-op rather
        // than racing it.
        if (applyingImportRef.current) {
          setSaving(false);
          return;
        }
        const parsed = revisionInputSchema.safeParse({
          title: next.title,
          excerpt: next.excerpt,
          contentJson: next.content,
          tripStartDate: next.dateMode === "range" ? next.tripStartDate : "",
          tripEndDate: next.dateMode === "range" ? next.tripEndDate : "",
          tripYear:
            next.dateMode === "year" && next.tripYear
              ? Number(next.tripYear)
              : undefined,
          travelStyle: next.travelStyle || undefined,
          totalExpenseNzdCents: next.expenseDollars
            ? Math.round(Number(next.expenseDollars) * 100)
            : undefined,
          contributorNote: next.contributorNote,
        });
        if (!parsed.success) {
          setSaveError(parsed.error.issues[0]?.message ?? "Invalid input.");
          setSaving(false);
          return;
        }
        setSaveError(null);
        queue.enqueue("fields", async () => {
          const result = await saveRevisionFieldsAction(
            revisionId,
            versionRef.current,
            parsed.data,
          );
          if (result.ok) {
            // Authoritative: the server's own new version, not an assumed
            // "+1" (Prompt 4 Sub-phase 4: save_revision_draft() now returns
            // it). Every OTHER mutation on this form still does `+= 1`
            // deliberately -- their RPCs have nothing else useful to return
            // and always bump by exactly 1 unconditionally on success, so
            // that remains correct, not a bug.
            versionRef.current = result.version;
            bumpVersion();
            setLastSavedAt(Date.now());
            // No toast here on purpose. Autosave fires on a debounce as the
            // contributor types, so a per-save toast meant a notification
            // every few seconds during ordinary writing -- it covered part
            // of the form, and (being in an aria-live region) it interrupted
            // a screen reader mid-sentence on every pause. Save state is
            // ambient information, not an event worth announcing: it belongs
            // in the persistent status line in the header, which is where it
            // now lives. Toasts stay for things that actually happen ONCE
            // and need acknowledging (submission, deletion, an error).
          } else {
            throw new Error(result.error);
          }
        });
      }, FIELDS_SAVE_DEBOUNCE_MS);
    },
    [queue, revisionId],
  );

  // Every field-backed value schedules its own save directly from the event
  // handler that changed it, rather than a single effect watching every
  // field — an effect that calls setState (queueing the debounced save
  // flips `saving`) on every keystroke is exactly the cascading-render
  // pattern React's own rules warn against; a save is a response to a
  // specific user action, not a resync with an external system.
  //
  // scheduleSave is a plain function recreated each render, so `title`,
  // `excerpt`, etc. below are always this render's (i.e. the last
  // committed) values — no ref needed. `overrides` supplies the one field
  // whose just-set value hasn't been committed to state yet at the moment
  // its own onChange handler calls this (state updates are async).
  type FieldsSnapshot = {
    title: string;
    excerpt: string;
    content: StoryContentBlock[];
    dateMode: "range" | "year";
    tripStartDate: string;
    tripEndDate: string;
    tripYear: string;
    travelStyle: string;
    expenseDollars: string;
    contributorNote: string;
  };

  function scheduleSave(overrides: Partial<FieldsSnapshot>) {
    queueFieldsSave({
      title,
      excerpt,
      content,
      dateMode,
      tripStartDate,
      tripEndDate,
      tripYear,
      travelStyle,
      expenseDollars,
      contributorNote,
      ...overrides,
    });
  }

  /**
   * Editorial content-import "Use this content": a destructive replacement
   * of the story body, on the SAME "fields" mutation-queue slot the normal
   * debounced autosave uses (so it coalesces with, rather than races,
   * anything already queued there). Unlike ordinary typing, visible editor
   * state (setContent) is only updated AFTER a successful save -- an
   * import that fails to save leaves the on-screen content exactly as it
   * was, and the caller (ContentImportPanel) keeps the converted blocks in
   * its own local state so the editor can retry without re-pasting.
   */
  async function applyImportedContent(
    blocks: StoryContentBlock[],
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    applyingImportRef.current = true;
    setApplyingImport(true);
    if (debounceHandle.current) {
      clearTimeout(debounceHandle.current);
      debounceHandle.current = null;
    }
    try {
      const parsed = revisionInputSchema.safeParse({
        title,
        excerpt,
        contentJson: blocks,
        tripStartDate: dateMode === "range" ? tripStartDate : "",
        tripEndDate: dateMode === "range" ? tripEndDate : "",
        tripYear:
          dateMode === "year" && tripYear ? Number(tripYear) : undefined,
        travelStyle: travelStyle || undefined,
        totalExpenseNzdCents: expenseDollars
          ? Math.round(Number(expenseDollars) * 100)
          : undefined,
        contributorNote,
      });
      if (!parsed.success) {
        return {
          ok: false,
          error: parsed.error.issues[0]?.message ?? "Invalid content.",
        };
      }

      setSaving(true);
      return await new Promise<{ ok: true } | { ok: false; error: string }>(
        (resolve) => {
          queue.enqueue("fields", async () => {
            const result = await saveRevisionFieldsAction(
              revisionId,
              versionRef.current,
              parsed.data,
            );
            if (result.ok) {
              versionRef.current = result.version;
              setContent(blocks);
              // The rich text editor is deliberately uncontrolled (see
              // story-content-editor.tsx) -- setContent() alone updates the
              // React state used to build the NEXT snapshot, but the
              // visible Plate document needs its own imperative resync, or
              // a subsequent keystroke's onChange would derive its
              // snapshot from the stale pre-import document and silently
              // undo the import on the next autosave.
              richTextEditorRef.current?.replaceContent(blocks);
              setSaveError(null);
              bumpVersion();
              setLastSavedAt(Date.now());
              resolve({ ok: true });
            } else {
              resolve({ ok: false, error: result.error });
              throw new Error(result.error);
            }
          });
        },
      );
    } finally {
      applyingImportRef.current = false;
      setApplyingImport(false);
    }
  }

  /**
   * An image was removed in the image panel: strip its embed tokens from the
   * story text too, so the editor stops showing an image the revision no
   * longer carries (the editor resolves embeds by mediaId through a private
   * preview URL, so an orphaned token keeps rendering there long after the
   * published page would show nothing at all). The database performs the
   * same strip authoritatively inside detach_story_media(); this is what
   * keeps THIS tab's in-memory content from re-saving the stale reference on
   * the next autosave -- which save_revision_draft would now reject.
   *
   * No save is scheduled: the detach mutation itself is what persists the
   * removal, and scheduling a content save here would race it on the same
   * version.
   */
  function handleMediaDetached(mediaId: string) {
    const text = storyContentText(content);
    const stripped = removeMediaEmbeds(text, mediaId);
    if (stripped === text) return;
    const next = markdownToStoryContent(stripped);
    setContent(next);
    // The editor is uncontrolled (see story-content-editor.tsx) -- without
    // this imperative resync the visible document would keep the token and
    // the next keystroke would put it straight back into the snapshot.
    richTextEditorRef.current?.replaceContent(next);
  }

  /**
   * Adding or removing a tag is a discrete action, not typing, so each one
   * saves immediately on the queue's own "tags" slot (the queue coalesces a
   * burst of them rather than racing). A tag the contributor typed that
   * names an existing lookup row is sent as a reference to that row -- and
   * set_revision_tags() re-does that resolution, the deduplication, and the
   * 20-tag cap server-side regardless of what this client sends.
   */
  function saveTags(next: RevisionTagSelection[]) {
    setSaving(true);
    queue.enqueue("tags", async () => {
      const result = await setTagsAction(
        revisionId,
        versionRef.current,
        next.map((tag) =>
          tag.id ? { id: tag.id } : { customLabel: tag.name },
        ),
      );
      if (result.ok) {
        versionRef.current += 1;
        bumpVersion();
        setLastSavedAt(Date.now());
      } else {
        throw new Error(result.error);
      }
    });
  }

  function changeTags(next: RevisionTagSelection[]) {
    setSelectedTags(next);
    saveTags(next);
  }

  function updateLocation(
    index: number,
    patch: Partial<(typeof locations)[number]>,
  ) {
    const next = locations.map((l, i) =>
      i === index ? { ...l, ...patch } : l,
    );
    setLocations(next);
    saveLocations(next);
  }

  function removeLocation(index: number) {
    const next = locations
      .filter((_, i) => i !== index)
      .map((l, i) => ({ ...l, sortOrder: i }));
    setLocations(next);
    saveLocations(next);
  }

  function saveLocations(next: typeof locations) {
    setSaving(true);
    queue.enqueue("locations", async () => {
      const result = await setLocationsAction(
        revisionId,
        versionRef.current,
        next,
      );
      if (result.ok) {
        versionRef.current += 1;
        bumpVersion();
        setLastSavedAt(Date.now());
      } else {
        throw new Error(result.error);
      }
    });
  }

  function handleLocationMatch(match: LocationMatch | null, label: string) {
    if (!match) {
      setLocationSearchNotice(
        label
          ? `No matching region found for "${label}" — pick manually below.`
          : "No matching region found — pick manually below.",
      );
      return;
    }
    const isDuplicate = locations.some(
      (l) =>
        l.regionId === match.regionId &&
        l.destinationId === match.destinationId,
    );
    if (isDuplicate) {
      setLocationSearchNotice(`"${label}" is already in the list below.`);
      return;
    }
    setLocationSearchNotice(null);
    const next = [
      ...locations,
      {
        regionId: match.regionId,
        destinationId: match.destinationId,
        sortOrder: locations.length,
      },
    ];
    setLocations(next);
    saveLocations(next);
  }

  // Live completeness, recomputed on every render from the same state the
  // autosave sends. Deliberately mirrors the preview page's
  // `missingRequirements` list rather than inventing a second standard --
  // a tick here must mean the same thing as "the submit panel will not
  // complain about this". Photos and Trip are genuinely optional: they tick
  // when filled, but their absence never blocks anything.
  const contentFilled = Boolean(storyContentText(content).trim());
  const tripFilled =
    dateMode === "year"
      ? Boolean(tripYear)
      : Boolean(tripStartDate && tripEndDate);
  const doneSteps: StoryStepId[] = (
    [
      [Boolean(title.trim()), "title"],
      [contentFilled, "story"],
      [initialMedia.length > 0, "photos"],
      [tripFilled, "trip"],
      [locations.length > 0 && selectedTags.length > 0, "places"],
    ] as const
  )
    .filter(([filled]) => filled)
    .map(([, id]) => id);

  // Exactly the list the preview page's submit gate uses -- same function,
  // so the editor can never invite a contributor forward into a step that
  // will immediately refuse them.
  const missingRequirements = missingStoryRequirements({
    title,
    hasContent: contentFilled,
    locationCount: locations.length,
    tagCount: selectedTags.length,
  });
  const canReview = missingRequirements.length === 0;

  const isLastEditingStep = stepIndex === STORY_STEPS.length - 2;
  const previousStep = stepIndex > 0 ? STORY_STEPS[stepIndex - 1] : null;
  const nextStep =
    stepIndex < STORY_STEPS.length - 2 ? STORY_STEPS[stepIndex + 1] : null;

  return (
    <div className="mx-auto max-w-3xl px-4 pb-16 sm:px-6">
      {/* Sticky, so the progress bar, the save state and Preview stay put
          while a long step (the story body, the photo grid) scrolls under
          them. `top-76px` is the site header's own min-height
          (components/site-header.tsx), which is sticky at top-0; z-30 keeps
          this under that header's z-40 rather than fighting it. */}
      <div className="sticky top-[76px] z-30 -mx-4 border-b border-border-subtle bg-background/95 px-4 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pt-3">
          <h1 className="text-lg font-semibold tracking-tight sm:text-xl">
            {isNewStory ? "New Story" : "Edit Story"}
          </h1>
          <div className="flex items-center gap-3 text-sm">
            <SaveStatus saving={saving} lastSavedAt={lastSavedAt} />
            <Link
              href={`/stories/${storyId}/preview`}
              className="journiq-button bg-accent text-sm text-accent-foreground"
            >
              Preview
            </Link>
          </div>
        </div>
        <div className="py-3">
          <StoryStepProgress
            currentStep={step}
            doneSteps={doneSteps}
            onSelect={goToStep}
            // "Review & submit" is a different route, reachable only by the
            // button at the end of step 5. Clicking its circle here used to
            // set an in-page step with no section to render -- a blank
            // screen. Locking it also makes the flow explicit: you leave
            // the editor deliberately, not by mis-clicking a dot.
            lockedSteps={REVIEW_STEP_LOCK}
          />
        </div>
      </div>

      {conflict && (
        <div
          role="alert"
          className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
        >
          This draft changed elsewhere (perhaps in another tab). Your edits on
          this page are still here, but saving is paused —{" "}
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="underline underline-offset-2"
          >
            reload to continue
          </button>
          .
        </div>
      )}
      {saveError && !conflict && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {saveError}
        </p>
      )}

      {/* One heading for the whole timeline rather than one per step: it is
          the thing focus moves to on every step change, so it has to say
          which step you just landed on. tabIndex -1 makes it focusable
          without putting it in the tab order. */}
      <h2
        ref={stepHeadingRef}
        tabIndex={-1}
        className="mt-6 text-2xl font-semibold tracking-tight outline-none sm:text-3xl"
      >
        {STORY_STEPS[stepIndex].label}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {STORY_STEPS[stepIndex].hint}
      </p>

      <div className="mt-6">
        <StepSection id="title" activeStep={step}>
          <div>
            <label htmlFor="edit-title" className="block text-sm font-medium">
              Title
              <RequiredMark />
            </label>
            <input
              id="edit-title"
              type="text"
              value={title}
              maxLength={200}
              onChange={(e) => {
                setTitle(e.target.value);
                scheduleSave({ title: e.target.value });
              }}
              className="mt-1 w-full rounded-md border border-border-subtle px-3 py-2 dark:bg-transparent"
            />
          </div>

          <div>
            <label htmlFor="edit-excerpt" className="block text-sm font-medium">
              Sub-Title
            </label>
            <textarea
              id="edit-excerpt"
              value={excerpt}
              maxLength={500}
              rows={2}
              onChange={(e) => {
                setExcerpt(e.target.value);
                scheduleSave({ excerpt: e.target.value });
              }}
              className="mt-1 w-full rounded-md border border-border-subtle px-3 py-2 dark:bg-transparent"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Optional. One or two lines that say what the story is about.
            </p>
          </div>
        </StepSection>

        <StepSection id="story" activeStep={step}>
          {showContentImport && (
            <ContentImportPanel
              onApply={applyImportedContent}
              disabled={applyingImport}
            />
          )}
          <div>
            <span className="block text-sm font-medium">
              Story
              <RequiredMark />
            </span>
            <div className="mt-1">
              <StoryContentEditor
                ref={richTextEditorRef}
                initialContent={initialContentJson}
                onChange={(blocks) => {
                  setContent(blocks);
                  scheduleSave({ content: blocks });
                }}
                // The editor's slash-menu "Photo" entry and toolbar image
                // button live on THIS step, but the image panel they point
                // at is on the next one -- so the request has to move the
                // timeline first, then focus, or it would scroll to a
                // section that is still `hidden`.
                onRequestImages={() => {
                  goToStep("photos");
                  requestAnimationFrame(focusImagesPanel);
                }}
              />
            </div>
          </div>
        </StepSection>

        <StepSection id="photos" activeStep={step}>
          <div
            id={IMAGES_PANEL_ID}
            tabIndex={-1}
            className="scroll-mt-[12rem] outline-none"
          >
            {/* No "Images (N)" heading here any more: the step is already
                titled "Photos", and the panel below opens with its own
                "N photos · N in your story" summary, so this was the third
                count on one screen. */}
            <p className="text-sm text-muted-foreground">
              Add photos here. &ldquo;Add to story&rdquo; drops one into your
              text and takes you back to it.
            </p>
            <div className="mt-3">
              <ImageUploadManager
                storyId={storyId}
                revisionId={revisionId}
                initialMedia={initialMedia}
                versionRef={versionRef}
                queue={queue}
                onVersionBumped={bumpVersion}
                inlineMediaIds={inlineMediaIds}
                onMediaDetached={handleMediaDetached}
                // Placing a photo moves the timeline to the story step and
                // shows it landing there. Before this, "Add to story"
                // inserted the embed into an editor that was on a hidden
                // step, so the contributor got no feedback at all and had
                // to walk back a step to find out whether it had worked.
                //
                // The step switch has to happen FIRST and the insert on the
                // next frame: CodeMirror cannot measure or scroll a
                // document inside a `display: none` section, so inserting
                // before the section is painted puts the embed in at the
                // right place but leaves the view scrolled somewhere else.
                onInsertIntoEditor={(mediaId, width) => {
                  goToStep("story");
                  requestAnimationFrame(() => {
                    richTextEditorRef.current?.insertMedia(mediaId, width);
                    // insertMedia focuses the editor, and focusing an
                    // element the page is not scrolled to can move the
                    // page. The step effect above already asked for the
                    // top; this re-asserts it AFTER the insert, so the
                    // contributor always lands looking at the editor with
                    // their new photo in it rather than somewhere down the
                    // page. Instant for the same reason as above.
                    requestAnimationFrame(() =>
                      window.scrollTo({ top: 0, behavior: "instant" }),
                    );
                  });
                }}
              />
            </div>
          </div>
        </StepSection>

        <StepSection id="trip" activeStep={step}>
          {/* Presentation only -- every handler below is the same
              setState-then-scheduleSave pair the two bare inputs used to
              carry inline, so the debounce window, the "fields" queue slot,
              and the exact string handed to scheduleSave are all unchanged. */}
          <TripDateField
            mode={dateMode}
            startDate={tripStartDate}
            endDate={tripEndDate}
            year={tripYear}
            onModeChange={(next) => {
              setDateMode(next);
              scheduleSave({ dateMode: next });
            }}
            onStartDateChange={(value) => {
              setTripStartDate(value);
              scheduleSave({ tripStartDate: value });
            }}
            onEndDateChange={(value) => {
              setTripEndDate(value);
              scheduleSave({ tripEndDate: value });
            }}
            onYearChange={(value) => {
              setTripYear(value);
              scheduleSave({ tripYear: value });
            }}
          />

          <div>
            <label
              htmlFor="edit-travel-style"
              className="block text-sm font-medium"
            >
              Travel style
            </label>
            <select
              id="edit-travel-style"
              value={travelStyleMode === "other" ? "other" : travelStyle}
              onChange={(e) => {
                const value = e.target.value;
                if (value === "other") {
                  // Switching mode alone doesn't save -- nothing changes on
                  // the server until real text is typed below, so toggling
                  // to "Other" and back to a preset without typing anything
                  // is a no-op, not a save of an empty string.
                  setTravelStyleMode("other");
                  return;
                }
                setTravelStyleMode("preset");
                setTravelStyle(value);
                scheduleSave({ travelStyle: value });
              }}
              className="mt-1 w-full rounded-md border border-border-subtle px-3 py-2 dark:bg-transparent"
            >
              <option value="">Not specified</option>
              {travelStyles.map((style) => (
                <option key={style} value={style}>
                  {formatCamelCaseLabel(style)}
                </option>
              ))}
              <option value="other">Other (type your own)</option>
            </select>
            {travelStyleMode === "other" && (
              <input
                type="text"
                value={travelStyle}
                maxLength={50}
                placeholder="Describe your travel style"
                onChange={(e) => {
                  setTravelStyle(e.target.value);
                  scheduleSave({ travelStyle: e.target.value });
                }}
                className="mt-2 w-full rounded-md border border-border-subtle px-3 py-2 dark:bg-transparent"
                aria-label="Other travel style (type your own)"
              />
            )}
          </div>

          <div>
            <label htmlFor="edit-expense" className="block text-sm font-medium">
              Total expenses (NZD)
            </label>
            <input
              id="edit-expense"
              type="number"
              min={0}
              step="0.01"
              value={expenseDollars}
              onChange={(e) => {
                setExpenseDollars(e.target.value);
                scheduleSave({ expenseDollars: e.target.value });
              }}
              className="mt-1 w-40 rounded-md border border-border-subtle px-3 py-2 dark:bg-transparent"
            />
          </div>
        </StepSection>

        <StepSection id="places" activeStep={step}>
          <fieldset>
            <legend className="text-sm font-medium">
              Locations
              <RequiredMark />
            </legend>
            <div className="mt-1">
              <LocationSearch
                regions={regions}
                destinations={destinations}
                onMatch={handleLocationMatch}
              />
              {locationSearchNotice && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {locationSearchNotice}
                </p>
              )}
            </div>
            <div className="mt-2 space-y-2">
              {locations.map((loc, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <select
                    value={loc.regionId}
                    onChange={(e) =>
                      updateLocation(i, {
                        regionId: e.target.value,
                        destinationId: null,
                      })
                    }
                    className="rounded-md border border-border-subtle px-2 py-1.5 text-sm dark:bg-transparent"
                  >
                    {regions.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => removeLocation(i)}
                    className="text-sm text-destructive underline underline-offset-2"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </fieldset>

          <TagEditor
            selected={selectedTags}
            suggestions={tags}
            onChange={changeTags}
          />

          <details className="rounded-md border border-border-subtle">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium select-none">
              Note to editors{" "}
              <span className="font-normal text-muted-foreground">
                (optional, private, never published)
              </span>
            </summary>
            <div className="border-t border-border-subtle p-3">
              <label htmlFor="edit-note" className="sr-only">
                Note to editors
              </label>
              <textarea
                id="edit-note"
                value={contributorNote}
                maxLength={2000}
                rows={3}
                onChange={(e) => {
                  setContributorNote(e.target.value);
                  scheduleSave({ contributorNote: e.target.value });
                }}
                className="w-full rounded-md border border-border-subtle px-3 py-2 dark:bg-transparent"
              />
            </div>
          </details>
        </StepSection>
      </div>

      {/* Says what is still missing, and takes you straight to it. Shown on
          the last editing step, where "Review & submit" is the next thing
          the contributor will reach for -- telling them there and then
          beats letting them arrive at step 6 and be turned away, which is
          what used to happen (the preview page has always had this gate;
          nothing pointed at it beforehand).

          role="status", not "alert": this is the standing state of the
          draft, not an event. It would be wrong to interrupt a screen
          reader with it on arrival. */}
      {isLastEditingStep && !canReview && (
        <div
          id={MISSING_REQUIREMENTS_ID}
          role="status"
          className="mt-8 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
        >
          <p className="font-medium">
            Add {missingRequirements.map((r) => r.label).join(", ")} before you
            can submit.
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {missingRequirements.map((requirement) => (
              <li key={requirement.label}>
                <button
                  type="button"
                  onClick={() => goToStep(requirement.step)}
                  className="rounded-md border border-amber-400 px-2.5 py-1 text-xs font-medium underline-offset-2 hover:underline dark:border-amber-700"
                >
                  Add {requirement.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Back / Next. On the last editing step, "Next" is a real link to
          the preview route -- step 6 of the same timeline, and the only
          place submission is authorized (see story-steps.tsx). */}
      <div className="mt-10 flex items-center justify-between gap-3 border-t border-border-subtle pt-6">
        {previousStep ? (
          <button
            type="button"
            onClick={() => goToStep(previousStep.id)}
            className="rounded-md border border-border-subtle px-4 py-2 text-sm font-medium"
          >
            ← {previousStep.label}
          </button>
        ) : (
          <Link
            href="/my-stories"
            className="rounded-md border border-border-subtle px-4 py-2 text-sm font-medium"
          >
            ← My Stories
          </Link>
        )}

        {isLastEditingStep ? (
          canReview ? (
            <Link
              href={`/stories/${storyId}/preview`}
              className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground"
            >
              Review &amp; submit →
            </Link>
          ) : (
            // A real disabled <button>, not a styled-down <Link>: a link is
            // followable by keyboard and by middle-click whatever it looks
            // like, so styling alone would let exactly the people it is
            // meant to help walk into a page that refuses them. It keeps
            // its place in the tab order so the reason is reachable, and
            // aria-describedby points at the list of what is missing.
            <button
              type="button"
              disabled
              aria-describedby={MISSING_REQUIREMENTS_ID}
              className="cursor-not-allowed rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground opacity-45"
            >
              Review &amp; submit →
            </button>
          )
        ) : (
          nextStep && (
            <button
              type="button"
              onClick={() => goToStep(nextStep.id)}
              className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground"
            >
              Next: {nextStep.label} →
            </button>
          )
        )}
      </div>
    </div>
  );
}
