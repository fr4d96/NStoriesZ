import Link from "next/link";
import type { Metadata } from "next";
import { listPublishedStories } from "@/lib/story/public-queries";
import { StoryCard } from "@/components/story/story-card";
import { PersonalExperienceLabel } from "@/components/story/personal-experience-label";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Real Working Holiday stories from New Zealand",
};

export default async function HomePage() {
  let featured: Awaited<ReturnType<typeof listPublishedStories>> = [];
  try {
    featured = await listPublishedStories({ limit: 6 });
  } catch {
    featured = [];
  }

  return (
    <div>
      <section className="border-b border-border-subtle bg-surface-muted">
        <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="max-w-2xl">
            <div className="mb-5">
              <PersonalExperienceLabel />
            </div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">
              Real, detailed Working Holiday stories from New Zealand
            </h1>
            <p className="mt-5 text-lg text-foreground/70">
              Structured, searchable, first-person accounts from people
              who&apos;ve done a Working Holiday Visa in New Zealand — organised
              by region, work, trip year, and travel style, so you can find a
              story like yours.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link
                href="/stories"
                className="rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-accent-foreground hover:opacity-90"
              >
                Find a story like yours
              </Link>
              <Link
                href="/about"
                className="rounded-md border border-border-subtle px-5 py-2.5 text-sm font-medium hover:bg-surface"
              >
                About this project
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
          <div>
            <h2 className="text-base font-semibold">Written, not filmed</h2>
            <p className="mt-2 text-sm text-foreground/70">
              Every story is a detailed written account, organised into the same
              structured format — never raw, unmoderated text.
            </p>
          </div>
          <div>
            <h2 className="text-base font-semibold">Personal, not advice</h2>
            <p className="mt-2 text-sm text-foreground/70">
              Each story reflects one person&apos;s experience. WHV Compass NZ
              is not Immigration New Zealand and gives no immigration, legal,
              employment, tax, or financial advice.
            </p>
          </div>
          <div>
            <h2 className="text-base font-semibold">
              Approved before published
            </h2>
            <p className="mt-2 text-sm text-foreground/70">
              Only stories that have gone through editorial and moderation
              review appear here — filterable by region, work, trip year, and
              travel style.
            </p>
          </div>
        </div>
      </section>

      {featured.length > 0 ? (
        <section className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xl font-semibold tracking-tight">
              Recent stories
            </h2>
            <Link href="/stories" className="text-sm hover:underline">
              Browse all stories
            </Link>
          </div>
          <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((story) => (
              <StoryCard key={story.story_id} story={story} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="border-t border-border-subtle bg-surface-muted">
        <div className="mx-auto max-w-5xl px-4 py-16 text-center sm:px-6">
          <h2 className="text-2xl font-semibold tracking-tight">
            Done your own Working Holiday in New Zealand?
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-foreground/70">
            Share your own story, under the name, initial, or pseudonym you
            choose — reviewed before it goes public.
          </p>
          <Link
            href="/sign-up"
            className="mt-6 inline-block rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-accent-foreground hover:opacity-90"
          >
            Share your story
          </Link>
        </div>
      </section>
    </div>
  );
}
