"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  revisionInputSchema,
  travelStyles,
  type StoryContentBlock,
} from "@/lib/validation/story";
import { RichTextEditor } from "@/components/story/rich-text-editor";
import { ImageUploadManager } from "@/components/story/image-upload-manager";
import { MutationQueue } from "@/lib/story/mutation-queue";
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
  initialTagIds: string[];
  initialMedia: RevisionMediaItem[];
  regions: ActiveRegion[];
  destinations: ActiveDestination[];
  workTypes: ActiveWorkType[];
  tags: ActiveTag[];
};

const FIELDS_SAVE_DEBOUNCE_MS = 600;

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
  initialTagIds,
  initialMedia,
  regions,
  destinations,
  workTypes,
  tags,
}: StoryEditFormProps) {
  const versionRef = useRef(initialVersion);
  const [conflict, setConflict] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [, forceRerender] = useState(0);

  const queue = useMemo(
    () =>
      new MutationQueue({
        onVersionConflict: () => setConflict(true),
        onError: (_slot, error) =>
          setSaveError(error instanceof Error ? error.message : "Save failed."),
        onSettled: () => setSaving(false),
      }),
    [],
  );

  function bumpVersion() {
    forceRerender((n) => n + 1);
  }

  const [title, setTitle] = useState(initialTitle);
  const [excerpt, setExcerpt] = useState(initialExcerpt);
  const [content, setContent] =
    useState<StoryContentBlock[]>(initialContentJson);
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
  const [workTypeIds, setWorkTypeIds] = useState<string[]>(initialWorkTypeIds);
  const [tagIds, setTagIds] = useState<string[]>(initialTagIds);

  const debounceHandle = useRef<ReturnType<typeof setTimeout> | null>(null);

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
            versionRef.current += 1;
            bumpVersion();
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

  function toggleWorkType(id: string) {
    const next = workTypeIds.includes(id)
      ? workTypeIds.filter((w) => w !== id)
      : [...workTypeIds, id];
    setWorkTypeIds(next);
    setSaving(true);
    queue.enqueue("workTypes", async () => {
      const result = await setWorkTypesAction(
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

  function toggleTag(id: string) {
    const next = tagIds.includes(id)
      ? tagIds.filter((t) => t !== id)
      : [...tagIds, id];
    setTagIds(next);
    setSaving(true);
    queue.enqueue("tags", async () => {
      const result = await setTagsAction(revisionId, versionRef.current, next);
      if (result.ok) {
        versionRef.current += 1;
        bumpVersion();
      } else {
        throw new Error(result.error);
      }
    });
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

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Edit Story
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
            Excerpt
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

        <div>
          <span className="block text-sm font-medium">Story</span>
          <div className="mt-1">
            <RichTextEditor
              initialContent={initialContentJson}
              onChange={(blocks) => {
                setContent(blocks);
                scheduleSave({ content: blocks });
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
                {style.replace("_", " ")}
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
          <div className="mt-1 space-y-2">
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
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-2 text-sm">
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
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-medium">Tags</legend>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-2 text-sm">
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

        <div>
          <span className="block text-sm font-medium">Images</span>
          <div className="mt-1">
            <ImageUploadManager
              storyId={storyId}
              revisionId={revisionId}
              initialMedia={initialMedia}
              versionRef={versionRef}
              queue={queue}
              onVersionBumped={bumpVersion}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
