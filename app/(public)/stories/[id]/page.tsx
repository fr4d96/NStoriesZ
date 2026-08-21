import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  getPublishedStoryBySlugCached,
  getPublishedStoryMedia,
  listPublishedStories,
  listPublicRegions,
} from "@/lib/story/public-queries";
import { getPublicImageUrl } from "@/lib/story/public-image-url";
import { imageBlockMediaIds } from "@/lib/validation/story";
import { normalizeStoryContentJson } from "@/lib/story/legacy-content";
import {
  ContentBlockRenderer,
  type ContentBlockMediaMap,
} from "@/components/story/content-block-renderer";
import { StoryGallery } from "@/components/story/story-gallery";
import { StoryCard } from "@/components/story/story-card";
import { AttributionChip } from "@/components/story/attribution-chip";
import { PersonalExperienceLabel } from "@/components/story/personal-experience-label";
import { ReportStoryForm } from "@/components/story/report-story-form";

export const revalidate = 60;

type RegionEntry = { region_name?: string; destination_name?: string | null };

function regionLabels(regions: unknown): string[] {
  if (!Array.isArray(regions)) return [];
  return regions
    .map((r: RegionEntry) =>
      r?.destination_name
        ? `${r.destination_name}, ${r.region_name}`
        : r?.region_name,
    )
    .filter((v): v is string => Boolean(v));
}

/** Bare region names only (no destination suffix) -- used to resolve a
 * region id for the related-stories lookup, since get_published_story()
 * returns region names, not ids (public-shape curation, docs/architecture.md). */
function regionLabelsRaw(regions: unknown): string[] {
  if (!Array.isArray(regions)) return [];
  return regions
    .map((r: RegionEntry) => r?.region_name)
    .filter((v): v is string => Boolean(v));
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function jsonLdScript(value: unknown) {
  // Never string-concatenate JSON-LD -- build from a controlled object and
  // escape "<" so a value containing "</script>" can't break out of the
  // script tag. This is metadata output, not rendered story body content,
  // but the same "never trust raw injected strings" discipline as
  // Engineering Rule 7 applies.
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export async function generateMetadata({
  params,
}: {
  // The dynamic segment is named `id` (not `slug`) to match the sibling
  // (contributor)/stories/[id]/ route group -- Next.js requires the same
  // parameter name for every route sharing this URL position across route
  // groups. The value itself is still the story's slug, not a UUID.
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id: slug } = await params;
  const story = await getPublishedStoryBySlugCached(slug);
  if (!story) return {};

  const coverUrl = getPublicImageUrl(
    (await getPublishedStoryMedia(story.story_id)).find((m) => m.is_cover)
      ?.public_url ?? null,
  );

  return {
    title: story.title,
    description: story.excerpt ?? undefined,
    alternates: { canonical: `/stories/${story.slug}` },
    robots: { index: true, follow: true },
    openGraph: {
      type: "article",
      title: story.title,
      description: story.excerpt ?? undefined,
      publishedTime: story.published_at,
      images: coverUrl ? [{ url: coverUrl }] : undefined,
    },
  };
}

export default async function StoryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: slug } = await params;
  const story = await getPublishedStoryBySlugCached(slug);
  if (!story) notFound();

  const [media, activeRegions] = await Promise.all([
    getPublishedStoryMedia(story.story_id),
    listPublicRegions(),
  ]);

  const firstRegionName = regionLabelsRaw(story.regions)[0] ?? null;
  const matchedRegionId = firstRegionName
    ? activeRegions.find((r) => r.name === firstRegionName)?.id
    : undefined;

  const sameRegionMatches = matchedRegionId
    ? await listPublishedStories({
        regionId: matchedRegionId,
        excludeStoryId: story.story_id,
        limit: 3,
      })
    : [];

  const relatedStories =
    sameRegionMatches.length >= 3
      ? sameRegionMatches
      : [
          ...sameRegionMatches,
          ...(await listPublishedStories({
            excludeStoryId: story.story_id,
            limit: 3,
          })),
        ]
          .filter(
            (s, i, arr) =>
              arr.findIndex((x) => x.story_id === s.story_id) === i,
          )
          .slice(0, 3);

  const parsedContent = normalizeStoryContentJson(story.content_json);

  // Images placed inline (an "image" block referencing a mediaId) render
  // via ContentBlockRenderer's own media map; the trailing StoryGallery
  // only shows what's NOT already placed in the text, so nothing appears
  // twice (see components/story/content-block-renderer.tsx's
  // ContentBlockMediaMap comment and story-gallery.tsx's updated header).
  const inlineMediaIds = new Set(
    parsedContent ? imageBlockMediaIds(parsedContent) : [],
  );
  const contentMedia: ContentBlockMediaMap = {};
  for (const m of media) {
    const url = getPublicImageUrl(m.public_url);
    if (url) {
      contentMedia[m.media_id] = {
        url,
        altText: m.alt_text,
        decorative: m.decorative,
      };
    }
  }
  const galleryMedia = media.filter((m) => !inlineMediaIds.has(m.media_id));

  const regions = regionLabels(story.regions);
  const tripLabel =
    story.trip_start_date && story.trip_end_date
      ? `${story.trip_start_date} – ${story.trip_end_date}`
      : story.trip_year
        ? String(story.trip_year)
        : null;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: story.title,
    description: story.excerpt ?? undefined,
    datePublished: story.published_at,
    author: { "@type": "Person", name: story.attribution_value ?? "Anonymous" },
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
      {/* Controlled JSON-LD only, see jsonLdScript() above -- never user content. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }}
      />

      <div className="mb-4">
        <PersonalExperienceLabel />
      </div>

      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
        {story.title}
      </h1>
      {story.excerpt ? (
        <p className="mt-3 text-lg text-foreground/70">{story.excerpt}</p>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-6">
        <AttributionChip
          name={story.attribution_value ?? "Anonymous"}
          contributorSlug={story.contributor_slug}
          tripYear={tripLabel ? undefined : story.trip_year}
          destination={regions[0] ?? null}
        />
        {tripLabel ? (
          <span className="text-sm text-foreground/60">Trip: {tripLabel}</span>
        ) : null}
      </div>

      {(regions.length > 0 || stringList(story.tags).length > 0) && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {Array.from(new Set([...regions, ...stringList(story.tags)])).map(
            (label) => (
              <span
                key={label}
                className="rounded-full bg-tag-background px-2 py-0.5 text-xs text-tag-foreground"
              >
                {label}
              </span>
            ),
          )}
        </div>
      )}

      <div className="mt-8">
        {parsedContent ? (
          <ContentBlockRenderer blocks={parsedContent} media={contentMedia} />
        ) : (
          <p className="text-destructive">
            This story&apos;s content couldn&apos;t be rendered.
          </p>
        )}
      </div>

      {galleryMedia.length > 0 ? (
        <div className="mt-10">
          <StoryGallery images={galleryMedia} />
        </div>
      ) : null}

      {story.total_expense_nzd_cents != null ? (
        <p className="mt-8 text-sm text-foreground/60">
          Traveller-reported cost: NZ$
          {(story.total_expense_nzd_cents / 100).toLocaleString()}
        </p>
      ) : null}

      <div className="mt-10 border-t border-border-subtle pt-6">
        <ReportStoryForm storyId={story.story_id} />
      </div>

      {relatedStories.length > 0 ? (
        <div className="mt-16">
          <h2 className="text-xl font-semibold tracking-tight">
            Related stories
          </h2>
          <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-3">
            {relatedStories.map((s) => (
              <StoryCard key={s.story_id} story={s} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
