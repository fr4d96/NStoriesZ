"use client";

import { useEffect, useId, useRef, useState } from "react";
import type {
  ActiveDestination,
  ActiveRegion,
} from "@/lib/story/active-lookups";

// Narrow structural types for just the slice of the Google Maps JS API this
// component touches -- no @types/google.maps dependency, and this repo never
// loads the SDK server-side (Engineering Rule 1 doesn't apply here since
// there's no secret involved, but there's still no reason to pull in a full
// ambient global type just for four fields).
type GoogleAddressComponent = {
  long_name: string;
  short_name: string;
  types: string[];
};
type GooglePlace = { address_components?: GoogleAddressComponent[] };
type GoogleAutocomplete = {
  addListener: (event: "place_changed", handler: () => void) => void;
  getPlace: () => GooglePlace;
};
type GoogleMapsPlacesNamespace = {
  Autocomplete: new (
    input: HTMLInputElement,
    opts?: { types?: string[]; fields?: string[] },
  ) => GoogleAutocomplete;
};
type GoogleMapsGlobal = { maps: { places: GoogleMapsPlacesNamespace } };

declare global {
  interface Window {
    google?: GoogleMapsGlobal;
  }
}

let scriptLoadPromise: Promise<void> | null = null;

function loadGoogleMapsScript(apiKey: string): Promise<void> {
  if (window.google?.maps?.places) return Promise.resolve();
  if (scriptLoadPromise) return scriptLoadPromise;
  scriptLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error("Failed to load Google Maps script."));
    document.head.appendChild(script);
  });
  return scriptLoadPromise;
}

/** Case/whitespace-insensitive equality, for matching a place name against a lookup row's name. */
function namesMatch(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
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
 * Google Places autocomplete search bar for picking a story location.
 * Deliberately does not store arbitrary place data (lat/lng/place_id) --
 * story_revision_locations only ever stores FK references into the
 * regions/destinations lookup tables (see supabase/migrations/20260803090300_story_revision_relations.sql),
 * so a selected place is matched back to the closest existing region (by
 * administrative_area) and destination (by locality) row by name. If
 * nothing matches, onMatch(null, ...) tells the caller to fall back to the
 * manual dropdowns below.
 */
export function LocationSearch({
  regions,
  destinations,
  onMatch,
}: LocationSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const [status, setStatus] = useState<
    "loading" | "ready" | "unconfigured" | "error"
  >(apiKey ? "loading" : "unconfigured");
  const inputId = useId();

  useEffect(() => {
    if (!apiKey) return;
    let cancelled = false;
    let autocomplete: GoogleAutocomplete | null = null;

    loadGoogleMapsScript(apiKey)
      .then(() => {
        if (cancelled || !inputRef.current || !window.google) return;
        autocomplete = new window.google.maps.places.Autocomplete(
          inputRef.current,
          {
            types: ["geocode"],
            fields: ["address_components"],
          },
        );
        autocomplete.addListener("place_changed", () => {
          const place = autocomplete!.getPlace();
          const components = place.address_components ?? [];
          const textFor = (type: string) =>
            components.find((c) => c.types.includes(type))?.long_name;

          const localityName =
            textFor("locality") ??
            textFor("sublocality") ??
            textFor("postal_town");
          const regionName =
            textFor("administrative_area_level_1") ??
            textFor("administrative_area_level_2");

          const matchedDestination = localityName
            ? destinations.find((d) => namesMatch(d.name, localityName))
            : undefined;
          const matchedRegion = matchedDestination
            ? regions.find((r) => r.id === matchedDestination.regionId)
            : regionName
              ? regions.find((r) => namesMatch(r.name, regionName))
              : undefined;

          const searchedLabel =
            inputRef.current?.value.trim() ?? localityName ?? regionName ?? "";

          if (matchedRegion) {
            onMatch(
              {
                regionId: matchedRegion.id,
                destinationId: matchedDestination?.id ?? null,
                label: searchedLabel,
              },
              searchedLabel,
            );
          } else {
            onMatch(null, searchedLabel);
          }
        });
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- regions/destinations are stable server-fetched props for the lifetime of this form
  }, []);

  return (
    <div>
      <label htmlFor={inputId} className="sr-only">
        Search for a place
      </label>
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        placeholder={
          status === "unconfigured"
            ? "Place search isn't configured — use the dropdowns below"
            : "Search for a city, town, or region…"
        }
        disabled={status === "unconfigured" || status === "error"}
        className="w-full rounded-md border border-black/15 px-3 py-2 text-sm disabled:opacity-60 dark:border-white/15 dark:bg-transparent"
      />
      {status === "error" && (
        <p className="mt-1 text-xs text-red-600 dark:text-red-400">
          Couldn&apos;t load place search — use the dropdowns below instead.
        </p>
      )}
    </div>
  );
}
