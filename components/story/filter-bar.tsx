"use client";

import { useId, useState } from "react";
import Link from "next/link";
import type { StorySearchFilters } from "@/lib/validation/discovery";
import { costBands } from "@/lib/validation/discovery";
import { FilterIcon, StorySearchIcon } from "@/components/icons";

type Option = { id: string; name: string };
type DestinationOption = Option & { regionId: string };

const costBandLabels: Record<(typeof costBands)[number], string> = {
  under_5k: "Under NZ$5k",
  "5k_15k": "NZ$5k – 15k",
  "15k_30k": "NZ$15k – 30k",
  "30k_plus": "NZ$30k+",
};

/**
 * Native GET <form> to /stories: works with JS disabled, and a submission
 * naturally omits cursorPublishedAt/cursorId (no hidden fields for them),
 * which is what resets pagination to the first page on every filter change
 * -- no extra "clear the cursor" logic needed. Collapses behind a toggle
 * button on small viewports, always visible at sm+ (design-brief
 * guidance) -- explicit state, not a native <details> (see the comment at
 * its render site for why).
 */
export function FilterBar({
  regions,
  destinations,
  tags,
  travelStyles,
  current,
}: {
  regions: Option[];
  destinations: DestinationOption[];
  tags: Option[];
  travelStyles: string[];
  current: StorySearchFilters;
}) {
  const [selectedRegion, setSelectedRegion] = useState(current.region ?? "");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersId = useId();
  const visibleDestinations = selectedRegion
    ? destinations.filter((d) => d.regionId === selectedRegion)
    : destinations;

  const fields = (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Region</span>
        <select
          name="region"
          defaultValue={current.region ?? ""}
          onChange={(e) => setSelectedRegion(e.target.value)}
          className="rounded-md border border-border-subtle bg-surface px-3 py-2"
        >
          <option value="">Any region</option>
          {regions.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Destination</span>
        <select
          name="destination"
          defaultValue={current.destination ?? ""}
          className="rounded-md border border-border-subtle bg-surface px-3 py-2"
        >
          <option value="">Any destination</option>
          {visibleDestinations.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Tag</span>
        <select
          name="tag"
          defaultValue={current.tag ?? ""}
          className="rounded-md border border-border-subtle bg-surface px-3 py-2"
        >
          <option value="">Any tag</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Trip year</span>
        <input
          type="number"
          name="tripYear"
          min={2000}
          max={2100}
          defaultValue={current.tripYear ?? ""}
          placeholder="Any year"
          className="rounded-md border border-border-subtle bg-surface px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Travel style</span>
        <select
          name="travelStyle"
          defaultValue={current.travelStyle ?? ""}
          className="rounded-md border border-border-subtle bg-surface px-3 py-2"
        >
          <option value="">Any style</option>
          {travelStyles.map((style) => (
            <option key={style} value={style}>
              {style}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Reported cost</span>
        <select
          name="costBand"
          defaultValue={current.costBand ?? ""}
          className="rounded-md border border-border-subtle bg-surface px-3 py-2"
        >
          <option value="">Any cost</option>
          {costBands.map((band) => (
            <option key={band} value={band}>
              {costBandLabels[band]}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Cost availability</span>
        <select
          name="hasReportedExpense"
          defaultValue={
            current.hasReportedExpense === undefined
              ? ""
              : String(current.hasReportedExpense)
          }
          className="rounded-md border border-border-subtle bg-surface px-3 py-2"
        >
          <option value="">Any story</option>
          <option value="true">Has a reported cost</option>
          <option value="false">No reported cost</option>
        </select>
      </label>
    </div>
  );

  return (
    <form
      method="get"
      action="/stories"
      className="rounded-xl border border-border-subtle bg-surface p-4 shadow-sm"
    >
      <label className="mb-4 flex flex-col gap-1 text-sm">
        <span className="font-medium">Search</span>
        <span className="relative">
          <StorySearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/50" />
          <input
            type="search"
            name="q"
            defaultValue={current.q ?? ""}
            placeholder="Find a story like yours"
            className="w-full rounded-md border border-border-subtle bg-surface py-2 pl-9 pr-3"
          />
        </span>
      </label>

      {/*
        Explicit state, not a native <details> -- confirmed live (Playwright,
        real Chromium) that a closed <details>'s children stay hidden from
        both the accessibility tree and visual rendering even with a CSS
        `display: block !important` override on them; a plain conditional
        class is what mobile-nav-toggle.tsx already uses for the same
        "collapsed on mobile, always visible on desktop" shape.
      */}
      <button
        type="button"
        aria-expanded={filtersOpen}
        aria-controls={filtersId}
        onClick={() => setFiltersOpen((value) => !value)}
        className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium sm:hidden"
      >
        <FilterIcon className="h-4 w-4" />
        {filtersOpen ? "Hide filters" : "Filters"}
      </button>
      <div id={filtersId} className={filtersOpen ? "block" : "hidden sm:block"}>
        {fields}
      </div>

      <div className="mt-4 flex gap-3">
        <button
          type="submit"
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
        >
          Apply filters
        </button>
        <Link
          href="/stories"
          className="rounded-md border border-border-subtle px-4 py-2 text-sm font-medium hover:bg-surface"
        >
          Clear
        </Link>
      </div>
    </form>
  );
}
