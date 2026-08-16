"use client";

import { useEffect, useId, useRef, useState } from "react";
import type {
  ActiveDestination,
  ActiveRegion,
} from "@/lib/story/active-lookups";

// OpenStreetMap Nominatim: free, no API key, no signup -- unlike Google
// Places this is a plain debounced fetch to a public search endpoint, not an
// SDK/widget. Usage policy (https://operations.osmfoundation.org/policies/nominatim/)
// caps this at ~1 request/second and asks for an identifying User-Agent or
// Referer; browsers block scripts from setting a custom User-Agent, but the
// browser's own Referer header (sent automatically, can't be spoofed by us)
// satisfies the same "identify your app" intent for this low-volume,
// interactive-typing use case. Debouncing well above 1/sec keeps this
// comfortably inside the policy even while a contributor is typing fast.
const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";
const DEBOUNCE_MS = 500;

type NominatimAddress = {
  city?: string;
  town?: string;
  village?: string;
  suburb?: string;
  state?: string;
  county?: string;
};
type NominatimResult = {
  place_id: number;
  display_name: string;
  address?: NominatimAddress;
};

/** Case/whitespace-insensitive equality, for matching a place name against a lookup row's name. */
function namesMatch(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

async function searchNominatim(
  query: string,
  signal: AbortSignal,
): Promise<NominatimResult[]> {
  const url = new URL(NOMINATIM_SEARCH_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "6");
  // Scoped to New Zealand -- this platform only covers NZ working-holiday
  // destinations, and narrowing here also cuts down irrelevant results.
  url.searchParams.set("countrycodes", "nz");
  const res = await fetch(url.toString(), { signal });
  if (!res.ok) throw new Error(`Nominatim search failed: ${res.status}`);
  return res.json();
}

function matchLocation(
  address: NominatimAddress | undefined,
  regions: ActiveRegion[],
  destinations: ActiveDestination[],
): { regionId: string; destinationId: string | null } | null {
  const localityName =
    address?.city ?? address?.town ?? address?.village ?? address?.suburb;
  const regionName = address?.state ?? address?.county;

  const matchedDestination = localityName
    ? destinations.find((d) => namesMatch(d.name, localityName))
    : undefined;
  const matchedRegion = matchedDestination
    ? regions.find((r) => r.id === matchedDestination.regionId)
    : regionName
      ? regions.find((r) => namesMatch(r.name, regionName))
      : undefined;

  if (!matchedRegion) return null;
  return {
    regionId: matchedRegion.id,
    destinationId: matchedDestination?.id ?? null,
  };
}

export type LocationMatch = {
  regionId: string;
  destinationId: string | null;
  label: string;
};

export type LocationSearchProps = {
  regions: ActiveRegion[];
  destinations: ActiveDestination[];
  onMatch: (match: LocationMatch | null, searchedLabel: string) => void;
};

/**
 * Free-text place search for picking a story location, backed by
 * OpenStreetMap's Nominatim (no API key). Deliberately does not store
 * arbitrary place data (lat/lng/osm id) -- story_revision_locations only
 * ever stores FK references into the regions/destinations lookup tables
 * (see supabase/migrations/20260803090300_story_revision_relations.sql), so
 * a selected result is matched back to the closest existing region (by
 * state/county) and destination (by city/town/village) row by name. If
 * nothing matches, onMatch(null, ...) tells the caller to fall back to the
 * manual dropdowns below.
 */
export function LocationSearch({
  regions,
  destinations,
  onMatch,
}: LocationSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NominatimResult[]>([]);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "searching" | "error">("idle");
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceHandle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputId = useId();

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function handleQueryChange(value: string) {
    setQuery(value);
    if (debounceHandle.current) clearTimeout(debounceHandle.current);
    abortRef.current?.abort();

    const trimmed = value.trim();
    if (trimmed.length < 3) {
      setResults([]);
      setStatus("idle");
      setOpen(false);
      return;
    }

    debounceHandle.current = setTimeout(() => {
      const controller = new AbortController();
      abortRef.current = controller;
      setStatus("searching");
      searchNominatim(trimmed, controller.signal)
        .then((data) => {
          setResults(data);
          setStatus("idle");
          setOpen(true);
        })
        .catch((err) => {
          if (err.name === "AbortError") return;
          setStatus("error");
          setResults([]);
        });
    }, DEBOUNCE_MS);
  }

  function handleSelect(result: NominatimResult) {
    const label = result.display_name.split(",")[0]?.trim() ?? query.trim();
    setQuery(label);
    setOpen(false);
    const match = matchLocation(result.address, regions, destinations);
    onMatch(match ? { ...match, label } : null, label);
  }

  return (
    <div ref={containerRef} className="relative">
      <label htmlFor={inputId} className="sr-only">
        Search for a place
      </label>
      <input
        id={inputId}
        type="text"
        value={query}
        onChange={(e) => handleQueryChange(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        placeholder="Search for a city, town, or region…"
        autoComplete="off"
        className="w-full rounded-md border border-border-subtle px-3 py-2 text-sm dark:bg-transparent"
      />
      {open && results.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full rounded-md border border-border-subtle bg-surface text-sm shadow-lg">
          {results.map((result) => (
            <li key={result.place_id}>
              <button
                type="button"
                onClick={() => handleSelect(result)}
                className="block w-full px-3 py-2 text-left hover:bg-surface-muted"
              >
                {result.display_name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {status === "error" && (
        <p className="mt-1 text-xs text-destructive">
          Place search failed — use the dropdowns below instead.
        </p>
      )}
      <p className="mt-1 text-xs text-muted-foreground">
        Search by{" "}
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2"
        >
          OpenStreetMap
        </a>{" "}
        contributors
      </p>
    </div>
  );
}
