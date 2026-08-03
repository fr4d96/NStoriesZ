import "server-only";
import { createClient } from "@/lib/supabase/server";

// Regions/destinations/work_types/tags all carry an `active` boolean
// (supabase/migrations/... regions/destinations/work_types/tags tables) so
// an entry can be retired from new authoring without breaking already-
// published stories that reference it. These are anonymous-readable lookup
// tables (no RLS restriction beyond `active`), used only to populate
// authoring-form pickers — never joined with any draft/pending content.

export type ActiveRegion = {
  id: string;
  name: string;
  slug: string;
  islandOrGrouping: string | null;
};

export type ActiveDestination = {
  id: string;
  name: string;
  slug: string;
  regionId: string;
};

export type ActiveWorkType = {
  id: string;
  name: string;
  slug: string;
};

export type ActiveTag = {
  id: string;
  name: string;
  slug: string;
};

export async function listActiveRegions(): Promise<ActiveRegion[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("regions")
    .select("id, name, slug, island_or_grouping")
    .eq("active", true)
    .order("name");
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    islandOrGrouping: r.island_or_grouping,
  }));
}

export async function listActiveDestinations(): Promise<ActiveDestination[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("destinations")
    .select("id, name, slug, region_id")
    .eq("active", true)
    .order("name");
  if (error) throw error;
  return (data ?? []).map((d) => ({
    id: d.id,
    name: d.name,
    slug: d.slug,
    regionId: d.region_id,
  }));
}

export async function listActiveWorkTypes(): Promise<ActiveWorkType[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("work_types")
    .select("id, name, slug")
    .eq("active", true)
    .order("name");
  if (error) throw error;
  return data ?? [];
}

export async function listActiveTags(): Promise<ActiveTag[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tags")
    .select("id, name, slug")
    .eq("active", true)
    .order("name");
  if (error) throw error;
  return data ?? [];
}
