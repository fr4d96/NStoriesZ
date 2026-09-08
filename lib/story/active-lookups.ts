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
 */
export async function listActiveExpenseCategories(): Promise<
  ActiveExpenseCategory[]
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("expense_categories")
    .select("id, name, slug, description")
    .eq("active", true)
    .order("sort_order")
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

/**
 * Resolves a revision's stored location rows into display labels, in the
 * order the contributor arranged them.
 *
 * DELIBERATELY DOES NOT FILTER ON `active`, unlike every reader above. Those
 * populate authoring pickers, where a retired entry must not be offered. This
 * one describes what a story ALREADY references, and a region retired after
 * publication is still where that person actually went — filtering it would
 * silently drop a place from their own export. Same reasoning as
 * get_revision_selections() resolving retired tag names server-side
 * (20260816100200_get_revision_selections_tag_names.sql).
 *
 * Label shape matches the public story page's `regionLabels()`:
 * "Destination, Region", or the bare region when there is no destination.
 */
export async function resolveLocationLabels(
  locations: readonly {
    regionId: string;
    destinationId: string | null;
    customDestinationLabel: string | null;
    sortOrder: number;
  }[],
): Promise<string[]> {
  if (locations.length === 0) return [];
  const supabase = await createClient();

  const regionIds = [...new Set(locations.map((l) => l.regionId))];
  const destinationIds = [
    ...new Set(
      locations
        .map((l) => l.destinationId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const [regions, destinations] = await Promise.all([
    supabase.from("regions").select("id, name").in("id", regionIds),
    destinationIds.length
      ? supabase
          .from("destinations")
          .select("id, name")
          .in("id", destinationIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (regions.error) throw regions.error;
  if (destinations.error) throw destinations.error;

  const regionName = new Map(
    (regions.data ?? []).map((r) => [r.id, r.name] as const),
  );
  const destinationName = new Map(
    (destinations.data ?? []).map((d) => [d.id, d.name] as const),
  );

  return [...locations]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((location) => {
      const region = regionName.get(location.regionId) ?? null;
      const destination = location.destinationId
        ? (destinationName.get(location.destinationId) ?? null)
        : location.customDestinationLabel;
      if (destination && region) return `${destination}, ${region}`;
      return destination ?? region;
    })
    .filter((label): label is string => Boolean(label));
}
