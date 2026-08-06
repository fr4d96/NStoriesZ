import Link from "next/link";
import type { Metadata } from "next";
import {
  listPublishedStories,
  listPublicRegions,
  listPublicDestinations,
} from "@/lib/story/public-queries";
import { HeroSlideshow } from "@/components/home/hero-slideshow";
import { FeaturedStoryStack } from "@/components/home/featured-story-stack";
import { StoryFilterGrid } from "@/components/home/story-filter-grid";
import { RegionExplorer } from "@/components/home/region-explorer";
import { DestinationQuiz } from "@/components/home/destination-quiz";
import { Eyebrow } from "@/components/home/eyebrow";
import { Reveal } from "@/components/home/reveal";
import { ArrowRightIcon } from "@/components/icons";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Real stories from across Aotearoa",
};

const steps = [
  [
    "01",
    "Discover real experiences",
    "Read honest stories from people who have already taken a working holiday.",
  ],
  [
    "02",
    "Learn what to expect",
    "Understand jobs, locations, costs, accommodation, and everyday challenges.",
  ],
  [
    "03",
    "Create your own journey",
    "Save useful stories and share your experience with the next traveller.",
  ],
] as const;

function SectionHeader({
  eyebrow,
  eyebrowTone,
  title,
  titleClassName = "",
  description,
  descriptionClassName = "text-foreground/65",
}: {
  eyebrow: string;
  eyebrowTone?: "default" | "onDark" | "onPhoto";
  title: string;
  titleClassName?: string;
  description: string;
  descriptionClassName?: string;
}) {
  return (
    <Reveal className="grid gap-5 md:grid-cols-[1fr_420px] md:items-end">
      <div>
        <Eyebrow tone={eyebrowTone}>{eyebrow}</Eyebrow>
        <h2 className={`journiq-heading mt-3 ${titleClassName}`}>{title}</h2>
      </div>
      <p className={descriptionClassName}>{description}</p>
    </Reveal>
  );
}

export default async function HomePage() {
  const [stories, regions, destinations] = await Promise.all([
    listPublishedStories({ limit: 24 }).catch(() => []),
    listPublicRegions(),
    listPublicDestinations(),
  ]);

  return (
    <div className="overflow-hidden">
      {/* -mt-[76px] tucks the hero in behind the sticky header (which stays
          a normal 76px-tall box, see components/site-header.tsx) so the
          photo runs full-bleed under the transparent header instead of
          leaving a gap -- this is scoped to just this section, not a
          site-wide layout change. */}
      <section className="relative isolate -mt-[76px] min-h-[720px] overflow-hidden bg-[#0b251e] text-white">
        <HeroSlideshow />
        <div className="relative mx-auto flex min-h-[720px] max-w-[1160px] items-end px-4 pt-40 pb-16 sm:px-6 sm:pb-20">
          <div className="max-w-4xl">
            <div className="hero-fade-item">
              <Eyebrow tone="onPhoto">Working holidays, told honestly</Eyebrow>
            </div>
            <h1
              className="hero-fade-item mt-5 max-w-[920px] font-[Georgia,'Times_New_Roman',serif] text-[clamp(3.5rem,8vw,7.7rem)] leading-[.93] tracking-[-.055em] text-white"
              style={{ animationDelay: "120ms" }}
            >
              Real stories from across Aotearoa.
            </h1>
            <p
              className="hero-fade-item mt-6 max-w-2xl text-lg text-white/80"
              style={{ animationDelay: "240ms" }}
            >
              Discover the jobs, places, challenges, friendships, and
              unforgettable moments shared by travellers who have lived the
              working-holiday experience.
            </p>
            <div
              className="hero-fade-item mt-7 flex flex-wrap gap-3"
              style={{ animationDelay: "360ms" }}
            >
              <Link
                href="#stories"
                className="journiq-button gap-1.5 bg-accent text-accent-foreground"
              >
                Explore stories <ArrowRightIcon className="h-4 w-4" />
              </Link>
              <Link
                href="#match"
                className="journiq-button border border-white/60 text-white"
              >
                Plan your journey
              </Link>
            </div>
            <p
              className="hero-fade-item mt-7 text-sm text-white/65"
              style={{ animationDelay: "480ms" }}
            >
              Stories from backpackers, seasonal workers, and travellers across
              Aotearoa.
            </p>
          </div>
        </div>
      </section>

      {stories.length > 0 ? (
        <>
          <section
            id="stories"
            className="bg-[#edf3ef] py-24 dark:bg-surface-muted"
          >
            <div className="mx-auto max-w-[1160px] px-4 sm:px-6">
              <SectionHeader
                eyebrow="Featured journals"
                title="Stories from the road"
                description="Honest experiences from people working, travelling, and building a life in New Zealand."
              />
              <div className="mt-10">
                <FeaturedStoryStack stories={stories.slice(0, 9)} />
              </div>
            </div>
          </section>

          <section id="match" className="py-24">
            <div className="mx-auto grid max-w-[1160px] gap-12 px-4 sm:px-6 lg:grid-cols-[.85fr_1.15fr]">
              <Reveal className="lg:sticky lg:top-28 lg:self-start">
                <Eyebrow>Find your match</Eyebrow>
                <h2 className="journiq-heading mt-3">
                  Where should your working holiday take you?
                </h2>
                <p className="mt-5 max-w-xl text-foreground/65">
                  Choose the setting, work, pace, and season that feel right. We
                  will match you with a region and relevant traveller stories.
                </p>
              </Reveal>
              <Reveal
                delayMs={120}
                className="rounded-[28px] border border-border-subtle bg-gradient-to-br from-surface to-surface-muted p-6 shadow-[0_22px_70px_rgba(23,63,53,.13)] sm:p-10"
              >
                <DestinationQuiz stories={stories} regions={regions} />
              </Reveal>
            </div>
          </section>

          <section id="discover" className="py-24">
            <div className="mx-auto max-w-[1160px] px-4 sm:px-6">
              <SectionHeader
                eyebrow="Browse by interest"
                title="Find a story that matches your journey"
                description="Filter first-hand accounts by work, lifestyle, or the challenge you want to understand before you arrive."
              />
              <div className="mt-8">
                <StoryFilterGrid stories={stories} />
              </div>
            </div>
          </section>

          <section id="regions" className="bg-forest py-24 text-white">
            <div className="mx-auto max-w-[1160px] px-4 sm:px-6">
              <SectionHeader
                eyebrow="Across the motu"
                eyebrowTone="onDark"
                title="Explore New Zealand by region"
                titleClassName="text-white"
                description="Each place offers a different rhythm of work and travel."
                descriptionClassName="text-white/65"
              />
              <div className="mt-10">
                <RegionExplorer
                  regions={regions}
                  destinations={destinations}
                  stories={stories}
                  tone="onForest"
                />
              </div>
            </div>
          </section>
        </>
      ) : null}

      <section id="how" className="py-24">
        <div className="mx-auto max-w-[1160px] px-4 sm:px-6">
          <Reveal>
            <Eyebrow>How Journiq helps</Eyebrow>
            <h2 className="journiq-heading mt-3 max-w-4xl">
              Practical insight, without losing the story
            </h2>
          </Reveal>
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {steps.map(([number, title, body], index) => (
              <Reveal key={number} delayMs={index * 85}>
                <article className="h-full rounded-b-2xl border-t-2 border-accent bg-surface p-7 transition hover:-translate-y-2 hover:shadow-xl">
                  <b className="font-[Georgia,'Times_New_Roman',serif] text-4xl text-accent">
                    {number}
                  </b>
                  <h3 className="mt-8 font-[Georgia,'Times_New_Roman',serif] text-2xl tracking-tight">
                    {title}
                  </h3>
                  <p className="mt-3 text-foreground/65">{body}</p>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20">
        <div className="mx-auto grid max-w-[1160px] overflow-hidden rounded-[28px] bg-surface-muted md:grid-cols-[.9fr_1.1fr]">
          <div className="min-h-[360px] bg-[url('https://images.unsplash.com/photo-1529156069898-49953e39b3ac?auto=format&fit=crop&w=1200&q=85')] bg-cover bg-center" />
          <Reveal className="flex flex-col justify-center p-8 sm:p-14">
            <Eyebrow>Community note</Eyebrow>
            <blockquote className="mt-5 font-[Georgia,'Times_New_Roman',serif] text-[clamp(2rem,4vw,3.8rem)] leading-[1.08] tracking-[-.04em]">
              &ldquo;A real vineyard story helped me understand the job before I
              arrived.&rdquo;
            </blockquote>
            <strong className="mt-6">Amélie R. · France</strong>
            <span className="text-foreground/55">
              Now living in Central Otago
            </span>
          </Reveal>
        </div>
      </section>

      <section id="share" className="journiq-share py-24 text-white">
        <div className="mx-auto max-w-[1160px] px-4 sm:px-6">
          <Reveal>
            <Eyebrow tone="onDark">Pass it forward</Eyebrow>
            <h2 className="journiq-heading mt-3 max-w-4xl text-white">
              Your experience could help someone take their first step
            </h2>
            <p className="mt-5 max-w-2xl text-white/75">
              Share the honest version of your working holiday—the wins,
              mistakes, practical lessons, and moments you will always remember.
            </p>
            <div className="mt-7 flex gap-3">
              <Link
                href="/sign-up"
                className="journiq-button bg-accent text-accent-foreground"
              >
                Share your story
              </Link>
              <Link
                href="/about"
                className="journiq-button border border-white/60 text-white"
              >
                See writing tips
              </Link>
            </div>
          </Reveal>
        </div>
      </section>
    </div>
  );
}
