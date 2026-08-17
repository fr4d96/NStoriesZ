"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { getPublicImageUrl } from "@/lib/story/public-image-url";
import {
  firstRegionLabel,
  regionNames,
  stringList,
} from "@/lib/story/card-fields";
import type { StoryCardData } from "@/components/story/story-card";
import { ArrowRightIcon } from "@/components/icons";

const ALL = "All";
const MAX_OPTIONS = 6;

/**
 * The catalogue index -- the landing page's single browse surface.
 *
 * Replaces what used to be three separate sections showing the same small
 * batch of stories (a featured grid, a filter grid, and a region tile grid).
 * Two or three filter axes narrow one continuous list of entries, so a
 * reader compares real records instead of re-reading the same few stories
 * in three different shapes.
 *
 * Every column is a field the story actually carries -- place, topic, trip
 * year -- so the index reads as a record rather than marketing. Nothing is
 * derived or fabricated: a field a story lacks is simply not rendered, and
 * each axis is built only from values present in this batch, so a chip can
 * never lead to an empty result and an axis with nothing to choose between
 * hides itself entirely.
 *
 * Place and topic stay separate axes on purpose. There is no longer a "Work"
 * axis: work types were retired as a taxonomy (2026-08-16) and the work
 * concepts that mattered ("Horticulture", "Hospitality", ...) are now
 * ordinary tags, so they arrive on the Topic axis.
 *
 * Filtering is client-side state over an already-fetched batch (no round
 * trip per chip). The full, server-filtered catalogue lives at `/stories`.
 */
export function StoryIndex({ stories }: { stories: StoryCardData[] }) {
  const axes = useMemo(() => {
    function axis(
      key: string,
      label: string,
      read: (s: StoryCardData) => string[],
    ) {
      const counts = new Map<string, number>();
      for (const story of stories) {
        for (const value of read(story)) {
          counts.set(value, (counts.get(value) ?? 0) + 1);
        }
      }
      const ranked = Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, MAX_OPTIONS);
      // An axis earns its row only if it can actually split this batch:
      // either it offers a choice between values, or its single value
      // excludes at least one story. One value every story shares filters
      // nothing, so it would be a control that does nothing when clicked.
      const partitions =
        ranked.length > 1 ||
        (ranked.length === 1 && ranked[0][1] < stories.length);
      return { key, label, read, options: ranked.map(([v]) => v), partitions };
    }
    return [
      axis("place", "Place", (s) => regionNames(s.regions)),
      axis("topic", "Topic", (s) => stringList(s.tags)),
    ].filter((a) => a.partitions);
  }, [stories]);

  const [active, setActive] = useState<Record<string, string>>({});

  const filtered = useMemo(
    () =>
      stories.filter((story) =>
        axes.every((axis) => {
          const value = active[axis.key];
          return !value || value === ALL || axis.read(story).includes(value);
        }),
      ),
    [stories, axes, active],
  );

  if (stories.length === 0) return null;

  const isFiltered = axes.some((a) => active[a.key] && active[a.key] !== ALL);

  return (
    <div>
      {axes.length > 0 ? (
        <div className="flex flex-col gap-5 border-b border-border-subtle pb-6">
          {axes.map((axis) => (
            <FilterRow
              key={axis.key}
              label={axis.label}
              options={[ALL, ...axis.options]}
              active={active[axis.key] ?? ALL}
              onChange={(value) =>
                setActive((current) => ({ ...current, [axis.key]: value }))
              }
            />
          ))}
        </div>
      ) : null}

      <p
        className="mt-5 font-mono text-xs tracking-wider text-foreground/50 tabular-nums"
        aria-live="polite"
      >
        {filtered.length} {filtered.length === 1 ? "ENTRY" : "ENTRIES"}
        {isFiltered ? (
          <>
            {" · "}
            <button
              type="button"
              onClick={() => setActive({})}
              className="underline underline-offset-4 hover:text-accent"
            >
              CLEAR
            </button>
          </>
        ) : null}
      </p>

      {filtered.length > 0 ? (
        <ul className="mt-4">
          {filtered.map((story, index) => (
            <IndexEntry key={story.story_id} story={story} position={index} />
          ))}
        </ul>
      ) : (
        <p className="mt-8 text-foreground/60">
          No stories carry all of those yet. Try clearing a filter.
        </p>
      )}

      <div className="mt-10">
        <Link href="/stories" className="night-button-primary">
          Browse the full catalogue <ArrowRightIcon className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}

function FilterRow({
  label,
  options,
  active,
  onChange,
}: {
  label: string;
  options: string[];
  active: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
      <span
        aria-hidden="true"
        className="font-mono text-xs tracking-[0.18em] text-foreground/45 sm:w-14 sm:shrink-0"
      >
        {label.toUpperCase()}
      </span>
      {/* Edge-to-edge horizontal scroll on phones so a long axis stays one
          line and the cut-off chip reads as "there is more"; wraps normally
          from sm up. */}
      <div
        role="group"
        aria-label={`Filter stories by ${label.toLowerCase()}`}
        className="nf-scroll-x -mx-4 flex snap-x gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
      >
        {options.map((option) => {
          const isActive = option === active;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={isActive}
              onClick={() => onChange(option)}
              className={`shrink-0 snap-start rounded-full border px-3.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors ${
                isActive
                  ? "border-accent bg-accent text-accent-foreground"
                  : "border-border-subtle text-foreground/80 hover:border-accent/60 hover:text-foreground"
              }`}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function IndexEntry({
  story,
  position,
}: {
  story: StoryCardData;
  position: number;
}) {
  const coverUrl = getPublicImageUrl(story.cover_image_path);
  // Only fields this story actually carries -- a missing field is omitted,
  // never rendered as a placeholder dash.
  const fields = [
    firstRegionLabel(story.regions),
    stringList(story.tags)[0],
    story.trip_year ? String(story.trip_year) : null,
  ].filter((value): value is string => Boolean(value));

  return (
    <li className="nf-entry nf-lift">
      {/* One grid, two shapes. Mobile: [numeral | stacked content]. Desktop:
          the inner wrapper switches to `display: contents` so its children
          drop into the parent grid as real catalogue columns
          [numeral | thumb | title | meta | arrow]. */}
      <Link
        href={`/stories/${story.slug}`}
        className="group grid grid-cols-[2.5rem_minmax(0,1fr)] items-start gap-x-3 py-6 md:grid-cols-[3rem_5rem_minmax(0,1fr)_13rem_1.5rem] md:items-center md:gap-x-6"
      >
        <span
          aria-hidden="true"
          className="pt-1 font-mono text-sm text-foreground/40 tabular-nums transition-colors group-hover:text-accent md:pt-0"
        >
          {String(position + 1).padStart(2, "0")}
        </span>

        <div className="hidden overflow-hidden rounded-md border border-border-subtle bg-surface-muted md:block">
          {coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- public bucket URLs are content-addressed, not a Next.js image-optimizable source list
            <img
              src={coverUrl}
              alt=""
              loading="lazy"
              className="h-14 w-20 object-cover transition-transform duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="h-14 w-20" />
          )}
        </div>

        <div className="md:contents">
          <div className="min-w-0">
            <h3 className="text-lg leading-snug font-bold tracking-[-.01em] text-balance text-foreground transition-colors group-hover:text-accent md:text-xl">
              {story.title}
            </h3>
            {story.excerpt ? (
              <p className="mt-1.5 line-clamp-2 text-sm text-foreground/60">
                {story.excerpt}
              </p>
            ) : null}
            {fields.length > 0 ? (
              <p className="mt-2 font-mono text-xs text-foreground/45 md:hidden">
                {fields.join("  ·  ")}
              </p>
            ) : null}
          </div>

          {fields.length > 0 ? (
            <ul className="hidden font-mono text-xs text-foreground/50 md:block">
              {fields.map((field, index) => (
                <li
                  // Index-suffixed, not the bare value: these fields are a
                  // region label, a tag, and a year, and nothing stops two of
                  // them being the same string -- a story tagged "Auckland"
                  // whose region is also Auckland duplicated the key and
                  // tripped React's unique-key warning. Freely-typed tags
                  // (2026-08-16) make the collision more likely, not less.
                  // Same convention as story-card.tsx / featured-story-slide.tsx.
                  key={`${field}-${index}`}
                  className={`truncate tabular-nums ${
                    index === 0 ? "" : "mt-1 text-foreground/40"
                  }`}
                >
                  {field}
                </li>
              ))}
            </ul>
          ) : (
            <span className="hidden md:block" />
          )}
        </div>

        <ArrowRightIcon
          aria-hidden="true"
          className="hidden h-4 w-4 text-foreground/30 transition-[color,transform] group-hover:translate-x-1 group-hover:text-accent md:block"
        />
      </Link>
    </li>
  );
}
