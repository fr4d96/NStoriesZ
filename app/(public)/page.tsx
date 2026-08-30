/**
 * DIRECTION CONTRACT -- "Night Field" (landing page)
 * World seed da6ac2c2 (user-pinned; supersedes that roll's assignment).
 * Structure seed 494761b9 (--scope surface --mode persuade), assigned
 * candidate 7 of the grounded list: the archive index.
 *
 * THESIS: a documentary archive's front door, not a travel product's --
 *   the page's spine is a real catalogue index whose columns are fields the
 *   stories actually carry, so the record itself is the proof. It refuses
 *   the category default of three photo-card grids showing the same stories
 *   three different ways.
 * OWN-WORLD: near-black ground (#05070a), raised dark surfaces (#0d1218),
 *   one cyan accent (#35d0c4) held for state and emphasis; heavy sans for
 *   display, Geist Mono for every numeral, column label, and index field.
 *   No serif, no terracotta, no kicker labels, no glyph icons.
 * STORY: cinematic first viewport establishes the place, a short featured
 *   lead shows what a story looks like, the index proves there is a real
 *   body of them and lets the reader narrow by place and work, the model is
 *   explained, and the page closes on one contribute CTA.
 * FIRST VIEWPORT: an inset slideshow PLATE (rounded, elevated, inside the
 *   page gutter -- not full-bleed; see The Mounted Plate Rule in DESIGN.md),
 *   heavy scrim, bottom-left headline with one cyan word, ghost-outline
 *   primary CTA plus a quiet text link, and a live numbered slide index
 *   tracking the actual active photo. The header sits solid above it rather
 *   than dissolving into it.
 * FORM: archive index. The Night Field palette this page introduced is now
 *   the app-wide token set (app/globals.css), so this page no longer scopes
 *   its own. Motion is one authored idea (a lens focus pull) expressed in
 *   CSS scroll timelines, never JS observers; see app/globals.css.
 * FINISH: unreviewed and undocumented is unfinished; this build ends with
 *   the finish review, the verdict, and DESIGN.md.
 *
 * (Recorded as a source comment, not an HTML comment in the rendered page,
 * since this is a multi-route Next.js app rather than a single static
 * artifact -- grep this file, not the built output.)
 */
import Link from "next/link";
import type { Metadata } from "next";
import { listPublishedStories } from "@/lib/story/public-queries";
import { HeroSlideshow } from "@/components/home/hero-slideshow";
import { FeaturedStoryStack } from "@/components/home/featured-story-stack";
import { StoryIndex } from "@/components/home/story-index";
import { DestinationQuiz } from "@/components/home/destination-quiz";
import { ArrowRightIcon } from "@/components/icons";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Real stories from across Aotearoa",
};

const steps = [
  [
    "Written by the person who lived it",
    "Every account is first-person, submitted under a name or pseudonym the writer chose themselves.",
  ],
  [
    "Checked before it is published",
    "Each story is reviewed against our publication rules, and its images are processed and rights-checked, before it appears here.",
  ],
  [
    "Kept as a record, not a feed",
    "Stories stay searchable by place, work, and year — there is nothing to scroll past and nothing to miss.",
  ],
] as const;

function SectionHead({
  title,
  description,
  className = "",
}: {
  title: string;
  description?: string;
  className?: string;
}) {
  return (
    <div
      className={`nf-pull grid gap-4 md:grid-cols-[1fr_420px] md:items-end md:gap-8 ${className}`}
    >
      <h2 className="night-heading">{title}</h2>
      {description ? (
        <p className="text-base text-foreground/65 sm:text-lg">{description}</p>
      ) : null}
    </div>
  );
}

export default async function HomePage() {
  const stories = await listPublishedStories({ limit: 24 }).catch(() => []);
  const hasStories = stories.length > 0;

  return (
    <div className="bg-background text-foreground">
      {/* Reading progress. Pure CSS scroll timeline -- no listener, no
          re-render. Sits directly under the sticky 76px header. */}
      <div
        aria-hidden="true"
        className="nf-progress pointer-events-none fixed inset-x-0 top-[76px] z-40 h-px"
      >
        <span className="block h-full w-full bg-accent" />
      </div>

      {/*
        The hero is an inset PLATE, not a full-bleed band.

        It used to run edge-to-edge with a `-mt-[76px]` tucking it behind a
        transparent header. That reads as cinema in the dark rendition, but in
        light mode it put a ~900px near-black slab hard against warm off-white
        paper -- a slab from a different design, not a page. Mounting the photo
        inside the page gutter with the palette's own radius and elevation makes
        it read as a photograph ON the page in both renditions, which is also
        truer to the archive thesis: an archive shows you a mounted plate.

        `overflow-hidden` + `isolate` keep the Ken Burns zoom clipped to the
        rounded box. svh rather than vh so a mobile URL bar collapsing does not
        resize the hero mid-scroll; clamped so it stays cinematic on a short
        phone and does not become a canyon on a tall desktop.
      */}
      <section className="px-4 pt-5 sm:px-6 sm:pt-6 lg:px-8">
        <div className="nf-dark-band relative isolate mx-auto flex h-[74svh] max-h-[780px] min-h-[520px] w-full max-w-[1440px] overflow-hidden rounded-[20px] bg-[#05070a] text-white shadow-2xl sm:rounded-[28px]">
          <HeroSlideshow />
          <div className="relative flex w-full items-end px-6 pb-12 sm:px-10 sm:pb-14 lg:px-14">
            <div className="max-w-3xl">
              <h1 className="nf-hero-pull font-sans text-[clamp(2.5rem,8vw,6.8rem)] leading-[0.95] font-extrabold tracking-[-.03em] text-balance text-white">
                Real stories from across{" "}
                <span className="text-accent">Aotearoa</span>.
              </h1>
              <p
                className="nf-hero-pull mt-5 max-w-lg text-base text-white/80 sm:mt-6 sm:text-lg"
                style={{ animationDelay: "140ms" }}
              >
                First-person accounts of the jobs, places, and moments from
                travellers who have lived the working-holiday experience.
              </p>
              <div
                className="nf-hero-pull mt-7 flex flex-wrap items-center gap-x-6 gap-y-4 sm:mt-8"
                style={{ animationDelay: "260ms" }}
              >
                <Link href="#index" className="night-button-primary">
                  Read the stories <ArrowRightIcon className="h-4 w-4" />
                </Link>
                <Link href="#how" className="night-button-ghost">
                  or see how this works
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {hasStories ? (
        <>
          {/* The featured lead: a publication's front-page story, ahead of
              the full record below it. */}
          <section className="py-16 sm:py-24 lg:py-28">
            <div className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-8">
              <SectionHead
                title="Featured"
                description="Drag a card aside, or step through with the arrows."
              />
              <div className="nf-pull mt-8 sm:mt-10">
                <FeaturedStoryStack stories={stories.slice(0, 5)} />
              </div>
            </div>
          </section>

          {/* The index: the page's spine and its only browse surface. */}
          <section
            id="index"
            className="scroll-mt-24 border-t border-border-subtle bg-surface py-16 sm:py-24 lg:py-28"
          >
            <div className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-8">
              <SectionHead
                title="Storiesss"
                description="Every published account, narrowed by where it happened and the work it describes."
              />
              <div className="mt-8 sm:mt-12">
                <StoryIndex stories={stories} />
              </div>
            </div>
          </section>
        </>
      ) : null}

      <section id="how" className="scroll-mt-24 py-16 sm:py-24 lg:py-28">
        <div className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-8">
          <SectionHead
            title="Why you can trust what you read here"
            description="Kakinotes is a record of personal experience — not advice, and not a marketplace."
          />
          <div className="mt-10 grid gap-4 sm:gap-5 md:mt-14 md:grid-cols-3">
            {steps.map(([title, body], index) => (
              <article
                key={title}
                className="nf-lift h-full rounded-2xl border border-border-subtle bg-surface p-6 shadow-sm transition-[transform,box-shadow] duration-300 hover:-translate-y-1.5 hover:shadow-lg sm:p-7"
                style={{ animationDelay: `${index * 60}ms` }}
              >
                {/* Deliberately not `.night-heading`: that class carries the
                    display clamp and, being defined after Tailwind's
                    utilities, wins over a `text-xl` override at equal
                    specificity. Card headings take the world's character
                    (heavy sans, tight tracking) at card scale instead. */}
                <h3 className="text-xl leading-snug font-extrabold tracking-[-.02em] text-balance sm:text-2xl">
                  {title}
                </h3>
                <p className="mt-3 text-foreground/65">{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {hasStories ? (
        <section
          id="match"
          className="scroll-mt-24 border-t border-border-subtle py-16 sm:py-24 lg:py-28"
        >
          <div className="mx-auto grid max-w-[1440px] gap-10 px-4 sm:px-6 lg:grid-cols-[.8fr_1.2fr] lg:gap-16 lg:px-8">
            <div className="nf-pull lg:sticky lg:top-28 lg:self-start">
              <h2 className="night-heading">
                Not sure where to start reading?
              </h2>
              <p className="mt-5 max-w-xl text-foreground/65">
                Answer five quick questions and we will point you at a region
                and the stories from travellers who went there. It is a starting
                point for browsing, not a recommendation.
              </p>
            </div>
            <div className="nf-pull rounded-[28px] border border-border-subtle bg-surface p-4 shadow-2xl sm:p-8 lg:p-10">
              <DestinationQuiz />
            </div>
          </div>
        </section>
      ) : null}

      <section
        id="share"
        className="nf-dark-band journiq-share scroll-mt-24 py-16 text-white sm:py-24 lg:py-28"
      >
        <div className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-8">
          <div className="nf-pull max-w-3xl">
            <h2 className="night-heading text-white">
              Your experience could help someone take their first step
            </h2>
            <p className="mt-5 max-w-2xl text-white/75">
              Share the honest version of your working holiday — the wins,
              mistakes, practical lessons, and moments you will always remember.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4">
              <Link href="/sign-up" className="night-button-primary">
                Share your story <ArrowRightIcon className="h-4 w-4" />
              </Link>
              <Link href="/about" className="night-button-ghost">
                See writing tips
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
