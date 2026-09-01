"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { getPublicImageUrl } from "@/lib/story/public-image-url";
import {
  firstRegionLabel,
  regionNames,
  stringList,
} from "@/lib/story/card-fields";
import type { StoryCardData } from "@/components/story/story-card";
import { ALL, FilterRow } from "@/components/story/filter-row";
import { ArrowRightIcon } from "@/components/icons";

const MAX_OPTIONS = 6;

/**
 * Entries shown at once. The record is the landing page's spine, and at
 * `listPublishedStories({ limit: 24 })` an unpaged list put two dozen
 * full-height entries between the filters and everything below them --
 * the section became the page. Five is enough to show what the record is
 * and how its entries read, without the rest of the page disappearing
 * under it.
 *
 * Paging, not "show more": this is an index with a numbered spine, and a
 * reader who has walked to entry 18 should be able to get back to it. The
 * full, server-filtered catalogue is still one click away at /stories.
 */
const PAGE_SIZE = 5;

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
  const [page, setPage] = useState(1);
  const listRef = useRef<HTMLUListElement>(null);
  // Set only by goToPage(), so the focus effect fires on a real page change
  // and never on first render.
  const pageChangedRef = useRef(false);

  /**
   * Changing a filter returns to the first page. Without it, narrowing a
   * 20-entry list while on page 4 lands on a page that no longer exists --
   * the clamp below would rescue the render, but the reader would still
   * have silently jumped pages without asking to.
   */
  function changeFilter(key: string, value: string) {
    setActive((current) => ({ ...current, [key]: value }));
    setPage(1);
  }

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

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  // Clamped rather than trusted: `page` can outlive the list it indexed
  // into (a filter applied from another axis, or a batch that shrank
  // between renders), and slicing past the end would render an empty page
  // with no way back except the browser's own back button.
  const currentPage = Math.min(page, pageCount);
  const firstIndex = (currentPage - 1) * PAGE_SIZE;
  const visible = filtered.slice(firstIndex, firstIndex + PAGE_SIZE);

  function goToPage(next: number) {
    const clamped = Math.min(Math.max(1, next), pageCount);
    if (clamped === currentPage) return;
    pageChangedRef.current = true;
    setPage(clamped);
    // Paging is a navigation: without this the reader is left at the
    // bottom of the section looking at the page controls, with the new
    // page's first entry somewhere above them. Focus moves too, so a
    // keyboard user's next Tab starts in the new page rather than back at
    // the filters, and a screen reader is told where it landed.
    // `instant` because app/globals.css sets `scroll-behavior: smooth` and
    // the focus() a line later cancels an animating scroll partway.
    requestAnimationFrame(() => {
      listRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
      listRef.current?.focus({ preventScroll: true });
    });
  }

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
              onChange={(value) => changeFilter(axis.key, value)}
            />
          ))}
        </div>
      ) : null}

      <p
        className="mt-5 font-mono text-xs tracking-wider text-foreground/50 tabular-nums"
        aria-live="polite"
      >
        {filtered.length} {filtered.length === 1 ? "ENTRY" : "ENTRIES"}
        {/* The showing-range lives inside the same aria-live region as the
            count, so paging announces itself the way filtering already
            did -- otherwise a page change is silent to a screen reader
            even though the whole list underneath has been replaced. */}
        {pageCount > 1 ? (
          <>
            {" · "}
            <span>
              SHOWING {firstIndex + 1}–{firstIndex + visible.length}
            </span>
          </>
        ) : null}
        {isFiltered ? (
          <>
            {" · "}
            <button
              type="button"
              onClick={() => {
                setActive({});
                setPage(1);
              }}
              className="underline underline-offset-4 hover:text-accent"
            >
              CLEAR
            </button>
          </>
        ) : null}
      </p>

      {filtered.length > 0 ? (
        <ul
          ref={listRef}
          // tabIndex -1 so goToPage() can move focus here without putting
          // the list itself in the tab order. scroll-mt clears the site
          // header, which is sticky at 76px.
          tabIndex={-1}
          className="mt-4 scroll-mt-24 outline-none"
        >
          {visible.map((story, index) => (
            <IndexEntry
              key={story.story_id}
              story={story}
              // Position in the WHOLE filtered record, not in this page --
              // the numerals are the index's spine, so entry 06 has to
              // stay entry 06 on page two rather than restarting at 01.
              position={firstIndex + index}
            />
          ))}
        </ul>
      ) : (
        <p className="mt-8 text-foreground/60">
          No stories carry all of those yet. Try clearing a filter.
        </p>
      )}

      {pageCount > 1 ? (
        <nav
          aria-label="Record pages"
          className="mt-8 flex flex-wrap items-center gap-2 border-t border-border-subtle pt-6"
        >
          <PageButton
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage === 1}
            label="Previous page"
          >
            ← Prev
          </PageButton>

          {/* Every page number, no ellipsis window: the landing page fetches
              at most 24 stories (see app/(public)/page.tsx), so this tops
              out at five buttons. */}
          {Array.from({ length: pageCount }, (_, i) => i + 1).map((number) => (
            <PageButton
              key={number}
              onClick={() => goToPage(number)}
              current={number === currentPage}
              label={`Page ${number} of ${pageCount}`}
            >
              {/* Plain "2", not the zero-padded "02" the entries use. The
                  numerals down the left of the record are its spine, and a
                  pager that renders in the same style puts a second "01" on
                  screen meaning something else entirely. */}
              {number}
            </PageButton>
          ))}

          <PageButton
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage === pageCount}
            label="Next page"
          >
            Next →
          </PageButton>
        </nav>
      ) : null}

      <div className="mt-10">
        <Link href="/stories" className="night-button-primary">
          Browse the full catalogue <ArrowRightIcon className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}

/**
 * One control in the pager. A real <button disabled> at the ends rather
 * than a hidden or styled-down one: the boundary stays visible, so "Prev"
 * does not vanish and shift every other control sideways the moment you
 * reach page one.
 */
function PageButton({
  children,
  onClick,
  current = false,
  disabled = false,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  current?: boolean;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-current={current ? "page" : undefined}
      // px-3.5 py-2 rather than something tighter: it lands the control at
      // the same 34px as the filter chips directly above it, so the two
      // rows of controls in this section read as one family, and it clears
      // WCAG 2.2's 24px minimum target with room for a thumb.
      className={`rounded-full px-3.5 py-2 font-mono text-xs tracking-wider tabular-nums transition-colors ${
        current
          ? "bg-accent text-accent-foreground"
          : "text-foreground/60 hover:text-accent disabled:pointer-events-none disabled:opacity-35"
      }`}
    >
      {children}
    </button>
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
