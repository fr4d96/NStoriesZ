type RegionEntry = { region_name?: string; destination_name?: string | null };

export function firstRegionLabel(regions: unknown): string | null {
  if (!Array.isArray(regions) || regions.length === 0) return null;
  const first = regions[0] as RegionEntry;
  if (!first?.region_name) return null;
  return first.destination_name
    ? `${first.destination_name}, ${first.region_name}`
    : first.region_name;
}

export function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

/** Every region name a story is tagged with (not just the first). */
export function regionNames(regions: unknown): string[] {
  if (!Array.isArray(regions)) return [];
  return regions
    .map((entry) => (entry as RegionEntry)?.region_name)
    .filter((name): name is string => typeof name === "string");
}

/**
 * Every destination (town/area) name a story is tagged with. A location row
 * that names only a region and no destination contributes nothing here.
 */
export function destinationNames(regions: unknown): string[] {
  if (!Array.isArray(regions)) return [];
  return regions
    .map((entry) => (entry as RegionEntry)?.destination_name)
    .filter((name): name is string => typeof name === "string");
}
