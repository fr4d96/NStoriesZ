import Link from "next/link";
import type {
  CountedSlice,
  TrendPoint,
} from "@/lib/story/moderation-analytics";
import { sumCounts } from "@/lib/story/moderation-analytics";

/**
 * Presentational-only pieces of the /moderation overview. Server Components
 * on purpose: every chart here is plain HTML/CSS driven by numbers the page
 * already computed, so the dashboard ships no charting dependency and no
 * client JS at all.
 *
 * Colour comes from --chart-1..4 (app/globals.css) -- ONE sequential teal
 * ramp with a per-rendition set of steps, so severity always reads as "more
 * contrast against this ground". Because it is a single hue it does not
 * introduce a second accent (DESIGN.md, The One Accent Rule); --destructive
 * appears only as a status cue and always alongside a written label, never
 * as colour alone.
 *
 * Nothing here relies on hover to disclose a value: every chart ships its
 * numbers in the legend and again in a real <table> under the plot, which
 * is what keeps it readable without JS and to a screen reader.
 */

/** Static map -- Tailwind only emits classes it can see as literals. */
const STEP_FILL: Record<1 | 2 | 3 | 4, string> = {
  1: "bg-chart-1",
  2: "bg-chart-2",
  3: "bg-chart-3",
  4: "bg-chart-4",
};

function percent(count: number, total: number): number {
  if (total <= 0) return 0;
  return (count / total) * 100;
}

export function SectionHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <div>
        <h2 className="text-base font-extrabold tracking-[-.02em]">{title}</h2>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? (
        <Link
          href={action.href}
          className="text-sm font-bold text-accent underline-offset-4 hover:underline"
        >
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}

export function Panel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-border-subtle bg-surface p-4 sm:p-5 ${className}`}
    >
      {children}
    </section>
  );
}

export function StatTile({
  label,
  value,
  hint,
  tone = "default",
  href,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "accent" | "critical";
  href?: string;
}) {
  const valueTone =
    tone === "critical"
      ? "text-destructive"
      : tone === "accent"
        ? "text-accent"
        : "text-foreground";

  const body = (
    <>
      <span className="font-mono text-[0.6875rem] tracking-[0.18em] text-muted-foreground uppercase">
        {label}
      </span>
      <span
        className={`mt-2 block text-3xl leading-none font-extrabold tracking-[-.03em] sm:text-4xl ${valueTone}`}
      >
        {value}
      </span>
      {hint ? (
        <span className="mt-2 block text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </>
  );

  const shell =
    "block rounded-xl border border-border-subtle bg-surface p-4 transition-transform";

  return href ? (
    <Link
      href={href}
      className={`${shell} hover:-translate-y-0.5 hover:shadow-md`}
    >
      {body}
    </Link>
  ) : (
    <div className={shell}>{body}</div>
  );
}

/**
 * Any ordered part-to-whole scale, not just queue age -> horizontal stacked
 * bar. A 2px surface gap (not a stroke) separates touching segments; the
 * track's ends are rounded once, so each segment stays square against its
 * neighbour and the bar reads as one quantity split up.
 *
 * The prop type is structural (StackedBarSegment) rather than
 * QueueAgeBucket so /admin can stack catalogue-pipeline stages through the
 * same primitive; QueueAgeBucket satisfies it, so /moderation is unchanged.
 * `describeTotal`/`emptyLabel` exist for the same reason -- the spoken
 * label is the only moderation-specific thing left in here, and both
 * default to exactly the wording /moderation had.
 */
export type StackedBarSegment = {
  key: string;
  label: string;
  shortLabel: string;
  count: number;
  step: 1 | 2 | 3 | 4;
};

export function AgeStackedBar({
  buckets,
  caption,
  describeTotal = (total) => `Wait time of ${total} submissions`,
  emptyLabel = "No dated submissions waiting.",
}: {
  buckets: StackedBarSegment[];
  caption: string;
  describeTotal?: (total: number) => string;
  emptyLabel?: string;
}) {
  const total = sumCounts(buckets);
  const present = buckets.filter((b) => b.count > 0);

  return (
    <figure className="m-0">
      <div
        className="flex h-4 w-full gap-[2px] overflow-hidden rounded-[4px] bg-surface-muted"
        role="img"
        aria-label={
          total === 0
            ? emptyLabel
            : `${describeTotal(total)}: ${buckets
                .filter((b) => b.count > 0)
                .map((b) => `${b.label}, ${b.count}`)
                .join("; ")}.`
        }
      >
        {present.map((bucket) => (
          <div
            key={bucket.key}
            className={STEP_FILL[bucket.step]}
            style={{ width: `${percent(bucket.count, total)}%` }}
          />
        ))}
      </div>

      {/*
        One line per bucket -- swatch, count, then the range. Stacking the
        count above the range put a 10px swatch beside a two-line block,
        which collided with its neighbour in the two-column mobile grid.
      */}
      <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        {buckets.map((bucket) => (
          <li key={bucket.key} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={`h-2.5 w-2.5 shrink-0 rounded-[2px] ${STEP_FILL[bucket.step]} ${
                bucket.count === 0 ? "opacity-35" : ""
              }`}
            />
            <span className="font-mono text-sm tabular-nums">
              {bucket.count}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {bucket.shortLabel}
            </span>
          </li>
        ))}
      </ul>

      <figcaption className="sr-only">{caption}</figcaption>
    </figure>
  );
}

/**
 * Ranked magnitude -> bars off a shared baseline, one hue. No legend: a
 * single series is named by the panel heading, and each row is directly
 * labelled, so colour carries no identity here at all.
 */
export function BarList({
  items,
  emptyLabel,
  ariaLabel,
}: {
  items: CountedSlice[];
  emptyLabel: string;
  ariaLabel: string;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }
  const max = Math.max(...items.map((item) => item.count), 1);

  return (
    <ul
      className="space-y-3"
      role="img"
      aria-label={`${ariaLabel}: ${items.map((i) => `${i.label}, ${i.count}`).join("; ")}.`}
    >
      {items.map((item) => (
        <li key={item.key}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm">{item.label}</span>
            <span className="font-mono text-sm tabular-nums text-muted-foreground">
              {item.count}
            </span>
          </div>
          <div className="mt-1.5 h-2 w-full rounded-[4px] bg-surface-muted">
            {/*
              The 2% floor keeps a small-but-real value visible. It must NOT
              apply to zero: a bar with length is read as a quantity, and
              /admin deliberately keeps zero rows (a "0 stories missing
              consent" row is the reassuring reading of that panel), which
              is where a floored zero first showed up as a sliver.
            */}
            {item.count > 0 ? (
              <div
                className="h-2 rounded-r-[4px] bg-chart-3"
                style={{ width: `${Math.max(percent(item.count, max), 2)}%` }}
              />
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Change over time -> columns, one series. Only the peak and the latest day
 * are labelled; the rest are carried by the axis ends and the table below,
 * because a number on every column goes unread.
 */
export function TrendColumns({
  points,
  ariaLabel,
}: {
  points: TrendPoint[];
  ariaLabel: string;
}) {
  const max = Math.max(...points.map((p) => p.count), 1);
  const peakIndex = points.reduce(
    (best, point, index) => (point.count > points[best].count ? index : best),
    0,
  );
  const total = sumCounts(points);

  const dayLabel = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-NZ", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });

  return (
    <figure className="m-0">
      <div
        className="flex h-24 items-end gap-[2px]"
        role="img"
        aria-label={`${ariaLabel}: ${total} in total, peaking at ${points[peakIndex].count} on ${dayLabel(points[peakIndex].date)}.`}
      >
        {points.map((point, index) => {
          const isLabelled =
            total > 0 && (index === peakIndex || index === points.length - 1);
          return (
            <div
              key={point.date}
              className="flex h-full flex-1 flex-col justify-end"
            >
              {isLabelled ? (
                <span className="mb-1 text-center font-mono text-[0.625rem] tabular-nums text-muted-foreground">
                  {point.count}
                </span>
              ) : null}
              <div
                className={
                  point.count > 0
                    ? "w-full rounded-t-[4px] bg-chart-3"
                    : "w-full rounded-t-[4px] bg-surface-muted"
                }
                style={{
                  height:
                    point.count > 0
                      ? `${Math.max((point.count / max) * 100, 6)}%`
                      : "2px",
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between font-mono text-[0.625rem] tracking-[0.14em] text-muted-foreground uppercase">
        <span>{dayLabel(points[0].date)}</span>
        <span>{dayLabel(points[points.length - 1].date)}</span>
      </div>
      <figcaption className="sr-only">{ariaLabel}</figcaption>
    </figure>
  );
}

/** The table view every chart on this page is required to have. */
export function DataTable({
  summary,
  columns,
  rows,
}: {
  summary: string;
  columns: [string, string];
  rows: { key: string; label: string; count: number }[];
}) {
  return (
    <details className="mt-auto pt-5 text-sm">
      <summary className="cursor-pointer text-xs font-bold text-muted-foreground">
        {summary}
      </summary>
      <table className="mt-2 w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-border-subtle">
            <th
              scope="col"
              className="py-1 font-mono text-[0.625rem] tracking-[0.14em] text-muted-foreground uppercase"
            >
              {columns[0]}
            </th>
            <th
              scope="col"
              className="py-1 text-right font-mono text-[0.625rem] tracking-[0.14em] text-muted-foreground uppercase"
            >
              {columns[1]}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-border-subtle/60">
              <th scope="row" className="py-1.5 font-normal">
                {row.label}
              </th>
              <td className="py-1.5 text-right font-mono tabular-nums">
                {row.count}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
