import { regionNames, stringList } from "@/lib/story/card-fields";

export type RegionMatchSignal = { workType?: string; tag?: string };

export type RegionMatchStory = {
  regions: unknown;
  work_types: unknown;
  tags: unknown;
};

export type RegionMatchResult = {
  regionName: string;
  storyCount: number;
  topWorkType: string | null;
};

/**
 * Scores each real region by how many of the given signals (work-type/tag
 * names) show up on stories tagged with that region, and returns the best
 * match -- or null if nothing matched at all. No region name is hardcoded:
 * everything comes from the fetched stories' own regions/work_types/tags,
 * so this stays correct as the regions table grows (CLAUDE.md: region is
 * data, not a hardcoded string).
 */
export function matchRegion(
  stories: RegionMatchStory[],
  signals: RegionMatchSignal[],
): RegionMatchResult | null {
  const scoreByRegion = new Map<string, number>();
  const storyCountByRegion = new Map<string, number>();
  const workTypeCountsByRegion = new Map<string, Map<string, number>>();

  for (const story of stories) {
    const names = regionNames(story.regions);
    if (names.length === 0) continue;

    const workTypes = stringList(story.work_types);
    const tags = stringList(story.tags);
    let matchScore = 0;
    for (const signal of signals) {
      if (signal.workType && workTypes.includes(signal.workType))
        matchScore += 1;
      if (signal.tag && tags.includes(signal.tag)) matchScore += 1;
    }
    if (matchScore === 0) continue;

    for (const name of names) {
      scoreByRegion.set(name, (scoreByRegion.get(name) ?? 0) + matchScore);
      storyCountByRegion.set(name, (storyCountByRegion.get(name) ?? 0) + 1);
      const workTypeCounts =
        workTypeCountsByRegion.get(name) ?? new Map<string, number>();
      for (const workType of workTypes) {
        workTypeCounts.set(workType, (workTypeCounts.get(workType) ?? 0) + 1);
      }
      workTypeCountsByRegion.set(name, workTypeCounts);
    }
  }

  if (scoreByRegion.size === 0) return null;

  const [topRegionName] = [...scoreByRegion.entries()].sort(
    (a, b) => b[1] - a[1],
  )[0];
  const workTypeCounts = workTypeCountsByRegion.get(topRegionName);
  const topWorkType = workTypeCounts
    ? ([...workTypeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
      null)
    : null;

  return {
    regionName: topRegionName,
    storyCount: storyCountByRegion.get(topRegionName) ?? 0,
    topWorkType,
  };
}
