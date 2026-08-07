import Link from "next/link";
import { getPublicImageUrl } from "@/lib/story/public-image-url";
import { firstRegionLabel, stringList } from "@/lib/story/card-fields";
import { AttributionChip } from "@/components/story/attribution-chip";

// AttributionChip can itself render a link to the contributor page; nesting
// that inside the card's own stretched title link would be an invalid
// nested <a>, so the card renders the chip without a contributor link
// (contributorSlug omitted) and relies on the title being the one
// clickable target, matching the "stretched link" pattern below.

export type StoryCardData = {
  story_id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  published_at: string;
  trip_year: number | null;
  travel_style: string | null;
  total_expense_nzd_cents: number | null;
  attribution_value: string | null;
  contributor_slug: string | null;
  cover_image_path: string | null;
  regions: unknown;
  work_types: unknown;
  tags: unknown;
};

/**
 * Approved-fields-only, per docs/design-brief.md's explicit anti-patterns:
 * no rating/score, no "Explore Now"-style CTA, no traveller-count badge.
 * Never fetches a full story body -- this renders exactly what
 * list_published_stories() already returned for the card, no follow-up
 * query per card.
 */
export function StoryCard({ story }: { story: StoryCardData }) {
  const coverUrl = getPublicImageUrl(story.cover_image_path);
  const regionLabel = firstRegionLabel(story.regions);
  const badges = [
    ...stringList(story.work_types),
    ...stringList(story.tags),
  ].slice(0, 3);

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-xl border border-border-subtle bg-surface transition-[transform,box-shadow] hover:-translate-y-1 hover:shadow-md">
      <div className="aspect-[4/3] w-full overflow-hidden bg-surface-muted">
        {coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- public bucket URLs are content-addressed, not a Next.js image-optimizable source list
          <img
            src={coverUrl}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-foreground/40">
            No photo
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
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
        <h3 className="text-lg font-semibold tracking-tight text-foreground">
          <Link href={`/stories/${story.slug}`} className="hover:underline">
            <span className="absolute inset-0" aria-hidden="true" />
            {story.title}
          </Link>
        </h3>
        {story.excerpt ? (
          <p className="line-clamp-3 text-sm text-foreground/70">
            {story.excerpt}
          </p>
        ) : null}
        <div className="mt-auto flex items-center justify-between gap-2 pt-2 text-sm text-foreground/70">
          <AttributionChip
            name={story.attribution_value ?? "Anonymous"}
            tripYear={story.trip_year}
            destination={regionLabel}
          />
        </div>
      </div>
    </article>
  );
}
