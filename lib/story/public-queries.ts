import "server-only";
import { cache } from "react";
import { createPublicClient } from "@/lib/supabase/public";
import type { CostBand } from "@/lib/validation/discovery";

// Every function here is deliberately cookie-free (lib/supabase/public.ts)
// rather than the session-bound lib/supabase/server.ts client -- reading
// next/headers' cookies() unconditionally opts a route out of static
// rendering/ISR in the App Router, and every RPC this module calls is one
// of the handful actually granted to `anon` (get_published_story,
// list_published_stories, get_published_story_media,
// list_distinct_public_travel_styles, list_public_contributors,
// get_public_contributor), so no session was ever needed to answer them.
//
// Which callers that cookie-freeness actually buys caching for (checked
// against the production build's route table, not assumed):
//   - app/(public)/page.tsx builds `○` static with a 1m revalidate.
//   - app/(public)/stories/[id] and app/(public)/contributors/[slug] are
//     ISR-cached per path at runtime with their own `revalidate = 60`.
//   - app/(public)/stories and app/(public)/contributors are NOT cached and
//     cannot be: both await searchParams, which forces dynamic rendering
//     regardless of the Supabase client used. Their `revalidate` exports
//     were no-ops and have been removed.
// The cookie-free client is still the right call for those two dynamic
// pages -- it keeps them off the session path entirely for reads that never
// needed a session -- it just isn't buying them a cache. Note the cost that
// leaves in place: /stories issues 5 round trips per visit (regions,
// destinations, tags, travel styles, stories) plus middleware's
// get_published_story existence check, on every request. Making it
// genuinely cacheable would mean moving filtering client-side.

export type PublishedStoriesFilter = {
  cursorPublishedAt?: string;
  cursorId?: string;
  limit?: number;
  regionId?: string;
  destinationId?: string;
  tagId?: string;
  tripYear?: number;
  travelStyle?: string;
  contributorId?: string;
  costBand?: CostBand;
  hasReportedExpense?: boolean;
  excludeStoryId?: string;
  search?: string;
};

/** Anonymous-safe: get_published_story() re-verifies every invariant itself. */
export async function getPublishedStoryBySlug(slug: string) {
  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("get_published_story", {
    p_slug: slug,
  });
  if (error) throw error;
  return data?.[0] ?? null;
}

/**
 * React-cache-wrapped: generateMetadata() and the page component both need
 * the same story, and this dedupes the RPC call to one per request instead
 * of two.
 */
export const getPublishedStoryBySlugCached = cache(getPublishedStoryBySlug);

export async function getPublishedStoryMedia(storyId: string) {
  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("get_published_story_media", {
    p_story_id: storyId,
  });
  if (error) throw error;
  return data ?? [];
}

/**
 * Keyset-paginated. p_limit is clamped server-side regardless of what's
 * passed. Card-shaped rows include cover image path, regions, and tags in
 * the same query (Prompt 5) -- no per-card follow-up query.
 */
export async function listPublishedStories(
  filter: PublishedStoriesFilter = {},
) {
  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("list_published_stories", {
    p_cursor_published_at: filter.cursorPublishedAt,
    p_cursor_id: filter.cursorId,
    p_limit: filter.limit,
    p_region_id: filter.regionId,
    p_destination_id: filter.destinationId,
    // p_work_type_id is deliberately never sent: the parameter still exists
    // on list_published_stories() (published revisions still carry work-type
    // rows) but nothing in the product filters by it any more.
    p_tag_id: filter.tagId,
    p_trip_year: filter.tripYear,
    p_travel_style: filter.travelStyle,
    p_contributor_id: filter.contributorId,
    p_cost_band: filter.costBand,
    p_has_reported_expense: filter.hasReportedExpense,
    p_exclude_story_id: filter.excludeStoryId,
    p_search: filter.search,
  });
  if (error) throw error;
  return data ?? [];
}

/** A contributor's published stories — same RPC, contributorId filter. */
export async function listContributorPublishedStories(
  contributorId: string,
  filter: Omit<PublishedStoriesFilter, "contributorId"> = {},
) {
  return listPublishedStories({ ...filter, contributorId });
}

/** Travel-style filter options, drawn only from currently-public stories. */
export async function listDistinctPublicTravelStyles() {
  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc(
    "list_distinct_public_travel_styles",
  );
  if (error) throw error;
  return (data ?? []).map((row) => row.travel_style);
}

export type PublicContributorsFilter = {
  cursorDisplayName?: string;
  cursorId?: string;
  limit?: number;
};

/** Public contributor directory: public, named, at-least-one-published-story only. */
export async function listPublicContributors(
  filter: PublicContributorsFilter = {},
) {
  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("list_public_contributors", {
    p_cursor_display_name: filter.cursorDisplayName,
    p_cursor_id: filter.cursorId,
    p_limit: filter.limit,
  });
  if (error) throw error;
  return data ?? [];
}

export async function getPublicContributor(slug: string) {
  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("get_public_contributor", {
    p_slug: slug,
  });
  if (error) throw error;
  return data?.[0] ?? null;
}

// --- Lookup tables, cookie-free variant ------------------------------------
//
// Same tables/rows lib/story/active-lookups.ts already reads (anon-readable
// where active = true) -- duplicated here rather than reused so the
// authoring UI's existing cookie-bound queries are untouched, and these
// public-page reads stay on the cookie-free client above.

export type PublicRegion = { id: string; name: string };
export type PublicDestination = { id: string; name: string; regionId: string };
export type PublicTag = { id: string; name: string };

export async function listPublicRegions(): Promise<PublicRegion[]> {
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from("regions")
    .select("id, name")
    .eq("active", true)
    .order("name");
  if (error) throw error;
  return data ?? [];
}

export async function listPublicDestinations(): Promise<PublicDestination[]> {
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from("destinations")
    .select("id, name, region_id")
    .eq("active", true)
    .order("name");
  if (error) throw error;
  return (data ?? []).map((d) => ({
    id: d.id,
    name: d.name,
    regionId: d.region_id,
  }));
}

// No listPublicWorkTypes: tags are the only taxonomy offered on the public
// browse surface as of 2026-08-16 (every non-fixture work_types row is now
// inactive).

export async function listPublicTags(): Promise<PublicTag[]> {
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from("tags")
    .select("id, name")
    .eq("active", true)
    .order("name");
  if (error) throw error;
  return data ?? [];
}
