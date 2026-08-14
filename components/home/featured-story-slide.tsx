import Link from "next/link";
import { getPublicImageUrl } from "@/lib/story/public-image-url";
import { firstRegionLabel, stringList } from "@/lib/story/card-fields";
import { AttributionChip } from "@/components/story/attribution-chip";
import type { StoryCardData } from "@/components/story/story-card";
import { ArrowRightIcon } from "@/components/icons";

/**
 * Two-pane (cover photo + copy) card face for the depth-stacked carousel in
 * components/home/featured-story-stack.tsx. Presentational only -- no client
 * state -- so it renders on the server inside the client stack.
 *
 * Deliberately NOT the stretched-link pattern StoryCard uses. This card is
 * draggable, and a full-card link fights that gesture: it made the whole
 * surface an <a>, which the stack's pointer-down guard rejected, so the card
 * could not be dragged at all. Here only the title and the explicit
 * "Read story" button navigate; every other part of the card is drag
 * surface. `contributorSlug` is still omitted on AttributionChip so it never
 * renders a link nested inside the title link.
 */
export function FeaturedStorySlide({
  story,
  priority = false,
}: {
  story: StoryCardData;
  priority?: boolean;
}) {
  const coverUrl = getPublicImageUrl(story.cover_image_path);
  const regionLabel = firstRegionLabel(story.regions);
  const badges = [
    ...stringList(story.work_types),
    ...stringList(story.tags),
  ].slice(0, 3);

  return (
    <article className="group relative grid h-full grid-rows-[minmax(0,34%)_minmax(0,1fr)] overflow-hidden rounded-[28px] border border-border-subtle bg-surface shadow-lg sm:grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)] sm:grid-rows-1">
      <div className="relative min-h-0 overflow-hidden bg-surface-muted">
        {coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- public bucket URLs are content-addressed, not a Next.js image-optimizable source list
          <img
            src={coverUrl}
            alt=""
            draggable={false}
            loading={priority ? "eager" : "lazy"}
            fetchPriority={priority ? "high" : undefined}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center px-4 text-center text-xs text-foreground/40">
            No photo
          </div>
        )}
        {regionLabel ? (
          <span className="absolute top-3 left-3 rounded-full bg-black/65 px-2.5 py-1 text-xs font-medium text-white backdrop-blur">
            {regionLabel}
          </span>
        ) : null}
      </div>
      <div className="flex min-h-0 min-w-0 flex-col justify-center gap-2 overflow-hidden p-6 sm:p-10">
        {badges.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {badges.map((badge, index) => (
              <span
                key={`${badge}-${index}`}
                className="rounded-full bg-tag-background px-2 py-0.5 text-xs text-tag-foreground"
              >
                {badge}
              </span>
            ))}
          </div>
        ) : null}
        {/* Sans, not the Field Journal serif: this card only ever renders
            inside the home page's Night Field world, whose contract is
            "no serif" -- see the direction contract in app/(public)/page.tsx. */}
        <h3 className="line-clamp-3 text-3xl leading-[1.05] font-extrabold tracking-[-.03em] text-balance text-foreground sm:text-4xl lg:text-5xl">
          <Link
            href={`/stories/${story.slug}`}
            className="transition-colors hover:text-accent focus-visible:text-accent"
          >
            {story.title}
          </Link>
        </h3>
        {story.excerpt ? (
          <p className="line-clamp-3 text-sm text-foreground/70">
            {story.excerpt}
          </p>
        ) : null}
        <div className="pt-2">
          <AttributionChip
            name={story.attribution_value ?? "Anonymous"}
            tripYear={story.trip_year}
            destination={regionLabel}
          />
        </div>
        <Link
          href={`/stories/${story.slug}`}
          className="night-button-primary mt-2 w-fit text-sm"
        >
          Read story <ArrowRightIcon className="h-4 w-4" />
        </Link>
      </div>
    </article>
  );
}
