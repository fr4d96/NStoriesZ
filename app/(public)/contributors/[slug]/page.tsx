import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  getPublicContributor,
  listContributorPublishedStories,
} from "@/lib/story/public-queries";
import { StoryCard } from "@/components/story/story-card";

export const revalidate = 60;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const contributor = await getPublicContributor(slug);
  if (!contributor) return {};
  return {
    title: contributor.display_name,
    description: contributor.bio ?? undefined,
    alternates: { canonical: `/contributors/${contributor.public_slug}` },
  };
}

export default async function ContributorDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const contributor = await getPublicContributor(slug);
  if (!contributor) notFound();

  const stories = await listContributorPublishedStories(
    contributor.contributor_id,
    { limit: 24 },
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16">
      <div className="flex items-center gap-4">
        <span
          aria-hidden="true"
          className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-muted text-2xl font-semibold text-foreground/70"
        >
          {contributor.display_name.trim().charAt(0).toUpperCase() || "?"}
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {contributor.display_name}
          </h1>
          <p className="text-sm text-foreground/60">
            {contributor.published_story_count}{" "}
            {contributor.published_story_count === 1 ? "story" : "stories"}{" "}
            published
          </p>
        </div>
      </div>

      {contributor.bio ? (
        <p className="mt-6 max-w-2xl text-foreground/70">{contributor.bio}</p>
      ) : null}

      <div className="mt-10">
        <h2 className="text-xl font-semibold tracking-tight">
          Published stories
        </h2>
        <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {stories.map((story) => (
            <StoryCard key={story.story_id} story={story} />
          ))}
        </div>
      </div>
    </div>
  );
}
