"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  revisionInputSchema,
  travelStyles,
  imageBlockMediaIds,
  type StoryContentBlock,
} from "@/lib/validation/story";
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
import { useToast } from "@/components/ui/toast";
import type { RevisionMediaItem } from "@/lib/story/contributor-queries";
import type {
  ActiveRegion,
  ActiveDestination,
  ActiveWorkType,
  ActiveTag,
} from "@/lib/story/active-lookups";
import {
  saveRevisionFieldsAction,
  setLocationsAction,
  setWorkTypesAction,
  setTagsAction,
} from "@/app/(contributor)/stories/[id]/edit/actions";

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
  initialWorkTypeIds: string[];
  initialCustomWorkType: string;
  initialTagIds: string[];
  initialCustomTag: string;
  initialMedia: RevisionMediaItem[];
  regions: ActiveRegion[];
  destinations: ActiveDestination[];
  workTypes: ActiveWorkType[];
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
};

const FIELDS_SAVE_DEBOUNCE_MS = 600;

/** "midRange" -> "Mid range" -- for displaying camelCase enum values. */
function formatCamelCaseLabel(value: string): string {
  const spaced = value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
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
  initialWorkTypeIds,
  initialCustomWorkType,
  initialTagIds,
  initialCustomTag,
  initialMedia,
  regions,
  destinations,
  workTypes,
  tags,
  showContentImport,
  isNewStory = false,
}: StoryEditFormProps) {
  const { showToast } = useToast();
  const versionRef = useRef(initialVersion);
  const [conflict, setConflict] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [, forceRerender] = useState(0);

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
  const [workTypeIds, setWorkTypeIds] = useState<string[]>(initialWorkTypeIds);
  const [customWorkType, setCustomWorkType] = useState(initialCustomWorkType);
  const [otherWorkTypeEnabled, setOtherWorkTypeEnabled] = useState(
    initialCustomWorkType !== "",
  );
  const [tagIds, setTagIds] = useState<string[]>(initialTagIds);
  const [customTag, setCustomTag] = useState(initialCustomTag);
  const [otherTagEnabled, setOtherTagEnabled] = useState(
    initialCustomTag !== "",
  );

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
            showToast("Draft saved.");
          } else {
            throw new Error(result.error);
          }
        });
      }, FIELDS_SAVE_DEBOUNCE_MS);
    },
    [queue, revisionId, showToast],
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

  function buildSelections(ids: string[], customLabel: string) {
    const selections: Array<{ id?: string; customLabel?: string }> = ids.map(
      (id) => ({ id }),
    );
    const trimmed = customLabel.trim();
    if (trimmed) selections.push({ customLabel: trimmed });
    return selections;
  }

  function saveWorkTypes(ids: string[], customLabel: string) {
    setSaving(true);
    queue.enqueue("workTypes", async () => {
      const result = await setWorkTypesAction(
        revisionId,
        versionRef.current,
        buildSelections(ids, customLabel),
      );
      if (result.ok) {
        versionRef.current += 1;
        bumpVersion();
      } else {
        throw new Error(result.error);
      }
    });
  }

  function saveTags(ids: string[], customLabel: string) {
    setSaving(true);
    queue.enqueue("tags", async () => {
      const result = await setTagsAction(
        revisionId,
        versionRef.current,
        buildSelections(ids, customLabel),
      );
      if (result.ok) {
        versionRef.current += 1;
        bumpVersion();
      } else {
        throw new Error(result.error);
      }
    });
  }

  function toggleWorkType(id: string) {
    const next = workTypeIds.includes(id)
      ? workTypeIds.filter((w) => w !== id)
      : [...workTypeIds, id];
    setWorkTypeIds(next);
    saveWorkTypes(next, customWorkType);
  }

  function toggleTag(id: string) {
    const next = tagIds.includes(id)
      ? tagIds.filter((t) => t !== id)
      : [...tagIds, id];
    setTagIds(next);
    saveTags(next, customTag);
  }

  const customWorkTypeDebounce = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  function onCustomWorkTypeChange(value: string) {
    setCustomWorkType(value);
    if (customWorkTypeDebounce.current)
      clearTimeout(customWorkTypeDebounce.current);
    setSaving(true);
    customWorkTypeDebounce.current = setTimeout(() => {
      saveWorkTypes(workTypeIds, value);
    }, FIELDS_SAVE_DEBOUNCE_MS);
  }

  function toggleOtherWorkType() {
    const next = !otherWorkTypeEnabled;
    setOtherWorkTypeEnabled(next);
    if (!next) onCustomWorkTypeChange("");
  }

  const customTagDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  function onCustomTagChange(value: string) {
    setCustomTag(value);
    if (customTagDebounce.current) clearTimeout(customTagDebounce.current);
    setSaving(true);
    customTagDebounce.current = setTimeout(() => {
      saveTags(tagIds, value);
    }, FIELDS_SAVE_DEBOUNCE_MS);
  }

  function toggleOtherTag() {
    const next = !otherTagEnabled;
    setOtherTagEnabled(next);
    if (!next) onCustomTagChange("");
  }

  function addLocation() {
    if (regions.length === 0) return;
    const next = [
      ...locations,
      {
        regionId: regions[0].id,
        destinationId: null,
        sortOrder: locations.length,
      },
    ];
    setLocations(next);
    saveLocations(next);
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
      } else {
        throw new Error(result.error);
      }
    });
  }

  const destinationsForRegion = (regionId: string) =>
    destinations.filter((d) => d.regionId === regionId);

  function handleLocationMatch(match: LocationMatch | null, label: string) {
    if (!match) {
      setLocationSearchNotice(
        label
          ? `No matching region found for "${label}" — pick manually below.`
          : "No matching region found — pick manually below.",
      );
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

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {isNewStory ? "New Story" : "Edit Story"}
        </h1>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-black/60 dark:text-white/60" aria-live="polite">
            {saving ? "Saving…" : "Saved"}
          </span>
          <Link
            href={`/stories/${storyId}/preview`}
            className="rounded-md border border-black/15 px-3 py-1.5 font-medium hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
          >
            Preview
          </Link>
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
        <p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-400">
          {saveError}
        </p>
      )}

      <div className="mt-6 space-y-6">
        <div>
          <label htmlFor="edit-title" className="block text-sm font-medium">
            Title
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
            className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 dark:border-white/15 dark:bg-transparent"
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
            className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 dark:border-white/15 dark:bg-transparent"
          />
        </div>

        {showContentImport && (
          <ContentImportPanel
            onApply={applyImportedContent}
            disabled={applyingImport}
          />
        )}

        <div>
          <span className="block text-sm font-medium">Story</span>
          <div className="mt-1">
            <StoryContentEditor
              ref={richTextEditorRef}
              initialContent={initialContentJson}
              onChange={(blocks) => {
                setContent(blocks);
                scheduleSave({ content: blocks });
              }}
              imageUpload={{
                storyId,
                revisionId,
                versionRef,
                onVersionBumped: bumpVersion,
              }}
            />
          </div>
        </div>

        <fieldset>
          <legend className="text-sm font-medium">When did you travel?</legend>
          <div className="mt-1 flex gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={dateMode === "range"}
                onChange={() => {
                  setDateMode("range");
                  scheduleSave({ dateMode: "range" });
                }}
              />
              Specific dates
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={dateMode === "year"}
                onChange={() => {
                  setDateMode("year");
                  scheduleSave({ dateMode: "year" });
                }}
              />
              Just the year
            </label>
          </div>
          {dateMode === "range" ? (
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <label className="flex items-center gap-2 text-sm">
                <span className="text-black/60 dark:text-white/60">From</span>
                <input
                  type="date"
                  value={tripStartDate}
                  onChange={(e) => {
                    setTripStartDate(e.target.value);
                    scheduleSave({ tripStartDate: e.target.value });
                  }}
                  className="rounded-md border border-black/15 px-3 py-2 dark:border-white/15 dark:bg-transparent"
                  aria-label="Trip start date"
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <span className="text-black/60 dark:text-white/60">To</span>
                <input
                  type="date"
                  value={tripEndDate}
                  onChange={(e) => {
                    setTripEndDate(e.target.value);
                    scheduleSave({ tripEndDate: e.target.value });
                  }}
                  className="rounded-md border border-black/15 px-3 py-2 dark:border-white/15 dark:bg-transparent"
                  aria-label="Trip end date"
                />
              </label>
            </div>
          ) : (
            <input
              type="number"
              value={tripYear}
              min={2000}
              max={2100}
              onChange={(e) => {
                setTripYear(e.target.value);
                scheduleSave({ tripYear: e.target.value });
              }}
              className="mt-2 w-32 rounded-md border border-black/15 px-3 py-2 dark:border-white/15 dark:bg-transparent"
              aria-label="Trip year"
            />
          )}
        </fieldset>

        <div>
          <label
            htmlFor="edit-travel-style"
            className="block text-sm font-medium"
          >
            Travel style
          </label>
          <select
            id="edit-travel-style"
            value={travelStyle}
            onChange={(e) => {
              setTravelStyle(e.target.value);
              scheduleSave({ travelStyle: e.target.value });
            }}
            className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 dark:border-white/15 dark:bg-transparent"
          >
            <option value="">Not specified</option>
            {travelStyles.map((style) => (
              <option key={style} value={style}>
                {formatCamelCaseLabel(style)}
              </option>
            ))}
          </select>
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
            className="mt-1 w-40 rounded-md border border-black/15 px-3 py-2 dark:border-white/15 dark:bg-transparent"
          />
        </div>

        <fieldset>
          <legend className="text-sm font-medium">Locations</legend>
          <div className="mt-1">
            <LocationSearch
              regions={regions}
              destinations={destinations}
              onMatch={handleLocationMatch}
            />
            {locationSearchNotice && (
              <p className="mt-1 text-xs text-black/60 dark:text-white/60">
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
                  className="rounded-md border border-black/15 px-2 py-1.5 text-sm dark:border-white/15 dark:bg-transparent"
                >
                  {regions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
                <select
                  value={loc.destinationId ?? ""}
                  onChange={(e) =>
                    updateLocation(i, { destinationId: e.target.value || null })
                  }
                  className="rounded-md border border-black/15 px-2 py-1.5 text-sm dark:border-white/15 dark:bg-transparent"
                >
                  <option value="">Whole region</option>
                  {destinationsForRegion(loc.regionId).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => removeLocation(i)}
                  className="text-sm text-red-600 underline underline-offset-2 dark:text-red-400"
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addLocation}
              className="text-sm underline underline-offset-2"
            >
              Add a location
            </button>
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-medium">Work types</legend>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            {workTypes.map((wt) => (
              <label key={wt.id} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={workTypeIds.includes(wt.id)}
                  onChange={() => toggleWorkType(wt.id)}
                />
                {wt.name}
              </label>
            ))}
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={otherWorkTypeEnabled}
                onChange={toggleOtherWorkType}
              />
              Other (type your own)
            </label>
            {otherWorkTypeEnabled && (
              <input
                type="text"
                value={customWorkType}
                maxLength={100}
                placeholder="Describe your work type"
                onChange={(e) => onCustomWorkTypeChange(e.target.value)}
                className="rounded-md border border-black/15 px-2 py-1.5 text-sm dark:border-white/15 dark:bg-transparent"
                aria-label="Other work type (type your own)"
              />
            )}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-medium">Tags</legend>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            {tags.map((tag) => (
              <label key={tag.id} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={tagIds.includes(tag.id)}
                  onChange={() => toggleTag(tag.id)}
                />
                {tag.name}
              </label>
            ))}
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={otherTagEnabled}
                onChange={toggleOtherTag}
              />
              Other (type your own)
            </label>
            {otherTagEnabled && (
              <input
                type="text"
                value={customTag}
                maxLength={100}
                placeholder="Add a tag"
                onChange={(e) => onCustomTagChange(e.target.value)}
                className="rounded-md border border-black/15 px-2 py-1.5 text-sm dark:border-white/15 dark:bg-transparent"
                aria-label="Other tag (type your own)"
              />
            )}
          </div>
        </fieldset>

        <div>
          <label htmlFor="edit-note" className="block text-sm font-medium">
            Note to editors (private, never published)
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
            className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 dark:border-white/15 dark:bg-transparent"
          />
        </div>

        <details className="rounded-md border border-black/10 dark:border-white/10">
          <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium">
            Images{initialMedia.length > 0 ? ` (${initialMedia.length})` : ""}
          </summary>
          <div className="border-t border-black/10 p-3 dark:border-white/10">
            <ImageUploadManager
              storyId={storyId}
              revisionId={revisionId}
              initialMedia={initialMedia}
              versionRef={versionRef}
              queue={queue}
              onVersionBumped={bumpVersion}
              inlineMediaIds={inlineMediaIds}
            />
          </div>
        </details>

        <div className="flex justify-end border-t border-black/10 pt-6 dark:border-white/10">
          <Link
            href={`/stories/${storyId}/preview`}
            className="rounded-md border border-black/15 px-3 py-1.5 text-sm font-medium hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
          >
            Preview
          </Link>
        </div>
      </div>
    </div>
  );
}
