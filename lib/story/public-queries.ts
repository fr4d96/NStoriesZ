import "server-only";
import { createClient } from "@/lib/supabase/server";

export type PublishedStoriesFilter = {
  cursorPublishedAt?: string;
  cursorId?: string;
  limit?: number;
  regionId?: string;
  destinationId?: string;
  workTypeId?: string;
  tagId?: string;
  tripYear?: number;
  travelStyle?: string;
  contributorId?: string;
};

/** Anonymous-safe: get_published_story() re-verifies every invariant itself. */
export async function getPublishedStoryBySlug(slug: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_published_story", {
    p_slug: slug,
  });
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function getPublishedStoryMedia(storyId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_published_story_media", {
    p_story_id: storyId,
  });
  if (error) throw error;
  return data ?? [];
}

/** Keyset-paginated. p_limit is clamped server-side regardless of what's passed. */
export async function listPublishedStories(
  filter: PublishedStoriesFilter = {},
) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_published_stories", {
    p_cursor_published_at: filter.cursorPublishedAt,
    p_cursor_id: filter.cursorId,
    p_limit: filter.limit,
    p_region_id: filter.regionId,
    p_destination_id: filter.destinationId,
    p_work_type_id: filter.workTypeId,
    p_tag_id: filter.tagId,
    p_trip_year: filter.tripYear,
    p_travel_style: filter.travelStyle,
    p_contributor_id: filter.contributorId,
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
