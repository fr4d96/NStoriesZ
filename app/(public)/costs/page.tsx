import type { Metadata } from "next";
import Link from "next/link";
import { createPublicClient } from "@/lib/supabase/public";
import { formatNzdCents } from "@/lib/story/expense-per-month";

export const metadata: Metadata = {
  title: "What a working holiday cost",
  description:
    "What real contributors recorded spending on their New Zealand working holiday — reported figures from published stories, not an estimate or a budget.",
};

// Aggregated from published stories, which change when a story is published,
// edited or withdrawn. Short-TTL ISR rather than force-dynamic: this is
// expensive to compute, identical for every reader, and nobody is harmed by
// it being an hour stale.
export const revalidate = 3600;

/**
 * "What it actually cost", across every published story.
 *
 * THE LINE THIS PAGE WALKS. docs/product-spec.md puts budgeting tools and
 * anything reading as personalised financial advice under MVP non-goals, and
 * Engineering Rule 17 makes every story a personal account. A page of money
 * figures is the easiest place on this site to cross that line by accident,
 * so it is written to report the PAST rather than predict a future: it asks
 * the reader nothing, it computes nothing about them, and every figure is
 * introduced by how many real people it came from.
 *
 * The distinction is not pedantry. "Half of the 40 people who recorded a cost
 * spent between X and Y" is a fact about those people. "You will need X" is
 * advice, and the difference is the whole reason this page is allowed to
 * exist at all.
 */

type Band = {
  story_count: number;
  median_cents: number;
  p25_cents: number;
  p75_cents: number;
} | null;

type NamedBand = {
  name?: string;
  region_name?: string;
  story_count: number;
  median_cents: number;
};

async function getAggregates() {
  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("get_expense_aggregates");
  if (error) throw error;
  const row = data?.[0];
  return {
    overall: (row?.overall ?? null) as Band,
    perMonth: (row?.per_month ?? null) as Band,
    byRegion: ((row?.by_region ?? []) as unknown as NamedBand[]) ?? [],
    byCategory: ((row?.by_category ?? []) as unknown as NamedBand[]) ?? [],
  };
}

/**
 * Says WHY a section is empty rather than hiding it. A missing section reads
 * as "we never thought about this"; this reads as "not enough people have
 * told us yet", which is both true and an invitation.
 */
function NotEnoughYet({ what }: { what: string }) {
  return (
    <p className="mt-2 text-sm text-foreground/60">
      Not enough published stories yet to report {what} honestly. Figures appear
      once at least five stories cover the same thing.
    </p>
  );
}

function BandFigure({ band, unit }: { band: NonNullable<Band>; unit: string }) {
  return (
    <>
      <p className="mt-2">
        <span className="text-3xl font-semibold">
          {formatNzdCents(band.median_cents)}
        </span>{" "}
        <span className="text-sm text-foreground/60">{unit}</span>
      </p>
      <p className="mt-1 text-sm text-foreground/60">
        Half of these {band.story_count} stories reported between{" "}
        <strong className="font-medium text-foreground">
          {formatNzdCents(band.p25_cents)}
        </strong>{" "}
        and{" "}
        <strong className="font-medium text-foreground">
          {formatNzdCents(band.p75_cents)}
        </strong>
        .
      </p>
    </>
  );
}

function NamedBandList({ rows }: { rows: NamedBand[] }) {
  return (
    <ul className="mt-3 divide-y divide-border-subtle border-t border-border-subtle">
      {rows.map((row) => {
        const label = row.region_name ?? row.name ?? "";
        return (
          <li
            key={label}
            className="flex items-baseline justify-between gap-4 py-2.5 text-sm"
          >
            <span className="min-w-0 flex-1 truncate">{label}</span>
            <span className="shrink-0 text-foreground/60">
              {row.story_count} {row.story_count === 1 ? "story" : "stories"}
            </span>
            <span className="shrink-0 tabular-nums font-medium">
              {formatNzdCents(row.median_cents)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export default async function CostsPage() {
  const { overall, perMonth, byRegion, byCategory } = await getAggregates();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">
        What a working holiday cost
      </h1>

      {/* The framing comes BEFORE any number, deliberately -- a reader who
          sees a figure first has already formed an expectation by the time
          they reach the caveat. */}
      <p className="mt-4 text-foreground/80">
        These are the figures contributors recorded about trips they actually
        took. They are a record of what happened to those people, not an
        estimate, a budget, or a prediction for your own trip. What a working
        holiday costs varies enormously by region, season, and how you travel.
      </p>

      <section aria-labelledby="costs-overall" className="mt-10">
        <h2 id="costs-overall" className="text-xl font-semibold tracking-tight">
          Reported total for a whole trip
        </h2>
        {overall ? (
          <BandFigure band={overall} unit="is the middle figure" />
        ) : (
          <NotEnoughYet what="a typical total" />
        )}
      </section>

      <section aria-labelledby="costs-per-month" className="mt-10">
        <h2
          id="costs-per-month"
          className="text-xl font-semibold tracking-tight"
        >
          Reported cost per month
        </h2>
        <p className="mt-1 text-sm text-foreground/60">
          From stories that recorded both trip dates, for trips of at least a
          month — a total on its own cannot tell a three-month trip from a year.
        </p>
        {perMonth ? (
          <BandFigure band={perMonth} unit="a month" />
        ) : (
          <NotEnoughYet what="a monthly figure" />
        )}
      </section>

      <section aria-labelledby="costs-by-region" className="mt-10">
        <h2
          id="costs-by-region"
          className="text-xl font-semibold tracking-tight"
        >
          By region
        </h2>
        {byRegion.length > 0 ? (
          <NamedBandList rows={byRegion} />
        ) : (
          <NotEnoughYet what="regional differences" />
        )}
      </section>

      <section aria-labelledby="costs-by-category" className="mt-10">
        <h2
          id="costs-by-category"
          className="text-xl font-semibold tracking-tight"
        >
          Where the money went
        </h2>
        {byCategory.length > 0 ? (
          <NamedBandList rows={byCategory} />
        ) : (
          <NotEnoughYet what="a breakdown by category" />
        )}
      </section>

      <p className="mt-12 border-t border-border-subtle pt-6 text-sm text-foreground/60">
        Every figure here comes from a story you can read in full.{" "}
        <Link href="/stories" className="underline underline-offset-2">
          Browse the stories
        </Link>{" "}
        to see the trips behind the numbers — the context is usually the part
        that matters.
      </p>
    </div>
  );
}
