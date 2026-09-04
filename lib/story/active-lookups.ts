import "server-only";
import { createClient } from "@/lib/supabase/server";
import { untypedFrom } from "@/lib/supabase/call-untyped-table";

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

/**
 * A curated expense category for the optional per-category breakdown
 * (2026-09-02). Same `active` retirement model as regions/destinations/
 * tags. Unlike tags there is NO contributor-authored escape hatch: an
 * expense exists to be aggregated across stories, and free text makes that
 * impossible -- the `other` category plus a per-row note carries the long
 * tail. See supabase/migrations/20260902110000_expense_categories.sql.
 */
export type ActiveExpenseCategory = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
};

/**
 * Ordered by the table's own `sort_order`, not alphabetically: the editor
 * lists these in trip order (flights, visa, insurance, then on-the-ground
 * costs), with "Other" deliberately last. Name breaks ties.
 *
 * Routed through untypedFrom() only because types/database.ts has not been
 * regenerated since this table's migration was written -- swap it for a
 * plain `supabase.from("expense_categories")` the moment it has.
 */
export async function listActiveExpenseCategories(): Promise<
  ActiveExpenseCategory[]
> {
  const supabase = await createClient();
  const { data, error } = await untypedFrom(supabase, "expense_categories")
    .select("id, name, slug, description")
    .eq("active", true)
    .order("sort_order")
    .order("name");
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    description: (row.description as string | null) ?? null,
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
