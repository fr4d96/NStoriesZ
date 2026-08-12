import type { Metadata } from "next";
import Link from "next/link";
import {
  listPublishedStories,
  listDistinctPublicTravelStyles,
  listPublicRegions,
  listPublicDestinations,
  listPublicWorkTypes,
  listPublicTags,
} from "@/lib/story/public-queries";
import { parseStorySearchParams } from "@/lib/validation/discovery";
import { FilterBar } from "@/components/story/filter-bar";
import { StoryCard } from "@/components/story/story-card";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Stories",
  description:
    "Browse real, first-person Working Holiday Visa stories from New Zealand, filterable by region, work type, trip year, travel style, and reported cost.",
};

type SearchParams = Record<string, string | string[] | undefined>;

export default async function StoriesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const rawParams = await searchParams;
  const filters = parseStorySearchParams(rawParams);

  const [regions, destinations, workTypes, tags, travelStyles] =
    await Promise.all([
      listPublicRegions(),
      listPublicDestinations(),
      listPublicWorkTypes(),
      listPublicTags(),
      listDistinctPublicTravelStyles(),
    ]);

  let stories: Awaited<ReturnType<typeof listPublishedStories>> = [];
  let loadError = false;
  try {
    stories = await listPublishedStories({
      regionId: filters.region,
      destinationId: filters.destination,
      workTypeId: filters.workType,
      tagId: filters.tag,
      tripYear: filters.tripYear,
      travelStyle: filters.travelStyle,
      costBand: filters.costBand,
      hasReportedExpense: filters.hasReportedExpense,
      search: filters.q,
      cursorPublishedAt: filters.cursorPublishedAt,
      cursorId: filters.cursorId,
      limit: 20,
    });
  } catch {
    loadError = true;
  }

  const last = stories[stories.length - 1];
  const nextPageParams = new URLSearchParams();
  for (const [key, value] of Object.entries(rawParams)) {
    if (
      typeof value === "string" &&
      key !== "cursorPublishedAt" &&
      key !== "cursorId"
    ) {
      nextPageParams.set(key, value);
    }
  }
  if (last) {
    nextPageParams.set("cursorPublishedAt", last.published_at);
    nextPageParams.set("cursorId", last.story_id);
  }
  const hasNextPage = stories.length === 20;

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-12 sm:px-6 sm:py-16">
      <div className="max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Stories
        </h1>
        <p className="mt-3 text-foreground/70">
          Real Working Holiday accounts from people who&apos;ve done it — filter
          by region, work, trip year, travel style, or reported cost to find one
          like yours.
        </p>
      </div>

      <div className="mt-8">
        <FilterBar
          regions={regions.map((r) => ({ id: r.id, name: r.name }))}
          destinations={destinations.map((d) => ({
            id: d.id,
            name: d.name,
            regionId: d.regionId,
          }))}
          workTypes={workTypes}
          tags={tags}
          travelStyles={travelStyles}
          current={filters}
        />
      </div>

      <div className="mt-8" aria-live="polite">
        {loadError ? (
          <p className="rounded-md border border-border-subtle bg-surface-muted p-6 text-sm text-foreground/70">
            We couldn&apos;t load stories right now. Please try again in a
            moment.
          </p>
        ) : stories.length === 0 ? (
          <p className="rounded-md border border-border-subtle bg-surface-muted p-6 text-sm text-foreground/70">
            No stories match those filters yet. Try broadening your search.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {stories.map((story) => (
              <StoryCard key={story.story_id} story={story} />
            ))}
          </div>
        )}
      </div>

      {hasNextPage ? (
        <div className="mt-10 flex justify-center">
          <Link
            href={`/stories?${nextPageParams.toString()}`}
            className="rounded-md border border-border-subtle px-4 py-2 text-sm font-medium hover:bg-surface-muted"
          >
            Load more stories
          </Link>
        </div>
      ) : null}
    </div>
  );
}
