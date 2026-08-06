"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { StoryCard, type StoryCardData } from "@/components/story/story-card";
import { stringList } from "@/lib/story/card-fields";
import { Reveal } from "@/components/home/reveal";
import { ArrowRightIcon } from "@/components/icons";

const ALL = "All stories";
const MAX_FILTERS = 8;
const MAX_CARDS = 6;

/**
 * Client-side filter chips over an already-fetched story batch (no extra
 * network round trip per click) -- chip labels are drawn from whichever
 * work-type/tag names actually appear in that batch, never hardcoded, so
 * the grid never offers a filter with zero results.
 */
export function StoryFilterGrid({ stories }: { stories: StoryCardData[] }) {
  const [active, setActive] = useState(ALL);

  const filters = useMemo(() => {
    const counts = new Map<string, number>();
    for (const story of stories) {
      const labels = [
        ...stringList(story.work_types),
        ...stringList(story.tags),
      ];
      for (const label of labels) {
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
    }
    const ranked = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_FILTERS)
      .map(([label]) => label);
    return [ALL, ...ranked];
  }, [stories]);

  const filtered = useMemo(() => {
    if (active === ALL) return stories;
    return stories.filter((story) =>
      [...stringList(story.work_types), ...stringList(story.tags)].includes(
        active,
      ),
    );
  }, [stories, active]);

  if (stories.length === 0) return null;

  return (
    <div>
      <div
        role="group"
        aria-label="Filter stories by interest"
        className="flex flex-wrap gap-2"
      >
        {filters.map((filter) => {
          const isActive = filter === active;
          return (
            <button
              key={filter}
              type="button"
              aria-pressed={isActive}
              onClick={() => setActive(filter)}
              className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                isActive
                  ? "border-accent bg-accent text-accent-foreground"
                  : "border-border-subtle text-foreground hover:bg-surface-muted"
              }`}
            >
              {filter}
            </button>
          );
        })}
      </div>

      {filtered.length > 0 ? (
        <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.slice(0, MAX_CARDS).map((story, index) => (
            <Reveal key={story.story_id} delayMs={(index % 4) * 85}>
              <StoryCard story={story} />
            </Reveal>
          ))}
        </div>
      ) : (
        <p className="mt-6 text-sm text-foreground/60">
          No stories match that filter yet.
        </p>
      )}

      <div className="mt-6">
        <Link
          href="/stories"
          className="inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
        >
          Browse all stories <ArrowRightIcon className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
