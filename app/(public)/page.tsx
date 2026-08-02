import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Real Working Holiday stories from New Zealand",
};

export default function HomePage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
      <section className="max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Detailed, first-person Working Holiday stories from New Zealand
        </h1>
        <p className="mt-4 text-lg text-black/70 dark:text-white/70">
          WHV Compass NZ shares real, structured, written stories from people
          who completed or are currently on a Working Holiday Visa in New
          Zealand — organised by region, work type, trip year, travel style, and
          reported cost, so you can find stories that match your own plans.
        </p>
        <p className="mt-4 text-sm text-black/60 dark:text-white/60">
          Every story is one person&apos;s personal experience. WHV Compass NZ
          is not Immigration New Zealand and does not provide immigration,
          legal, employment, tax, or financial advice.
        </p>
        <div className="mt-8 flex flex-wrap gap-4">
          <Link
            href="/stories"
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-black/80 dark:bg-white dark:text-black dark:hover:bg-white/80"
          >
            Browse stories
          </Link>
          <Link
            href="/about"
            className="rounded-md border border-black/20 px-4 py-2 text-sm font-medium hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            About this project
          </Link>
        </div>
      </section>
    </div>
  );
}
