import "server-only";
import { createClient } from "@/lib/supabase/server";

// Regions/destinations/tags all carry an `active` boolean
// (supabase/migrations/... regions/destinations/tags tables) so an entry can
// be retired from new authoring without breaking already-published stories
// that reference it. These are anonymous-readable lookup tables (no RLS
// restriction beyond `active`), used only to populate authoring-form pickers
// — never joined with any draft/pending content.
//
// There is deliberately no work_types reader here: tags are the platform's
// only taxonomy as of 2026-08-16, and every non-fixture work_types row is
// now `active = false` (see
// supabase/migrations/20260816100100_curate_whv_tags_retire_work_types.sql).
// The table itself is retained because published revisions still reference
// it.

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
