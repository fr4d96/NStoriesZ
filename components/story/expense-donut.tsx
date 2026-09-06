import { formatNzdCents } from "@/lib/story/expense-per-month";

/**
 * Where the money went, as a donut beside the inputs that produced it.
 *
 * Hand-drawn SVG rather than a charting library: this is one figure with
 * one shape, and every library that draws it would also bring its own
 * theming, its own font stack and its own DOM (Engineering Rule 20 -- no
 * dependency without a reason). Arc maths is ~20 lines and themes itself
 * from the app's own tokens for free.
 *
 * ACCESSIBILITY. The SVG is aria-hidden and carries no information of its
 * own: identity comes from the legend below it (name + amount + share, in
 * ink tokens, never color alone), and the editable list to its left is the
 * full table of the same numbers. A screen reader gets the data twice
 * without ever being read a slice.
 *
 * SIX SLICES, HARD CAP. Past ~6 segments a donut stops being readable at a
 * glance, so the tail folds into one "Smaller categories" slice instead of
 * growing a seventh hue -- a generated hue is indistinguishable from an
 * existing one under colour-vision deficiency. The fold label deliberately
 * says "Smaller categories" and not "Other", because "Other" is a real
 * expense category a contributor may have picked and both could be on
 * screen at once.
 */

/** Matches --expense-1..6 in globals.css. Fixed order, never cycled. */
const SLICE_COUNT = 6;

/** Outer radius, inner radius and box are in one 200x200 user-space grid. */
const BOX = 200;
const CENTER = BOX / 2;
const OUTER_R = 92;
const INNER_R = 58;

export type ExpenseSlice = { label: string; cents: number };

type ResolvedSlice = ExpenseSlice & { color: string; share: number };

/**
 * Descending by amount, capped at SLICE_COUNT with the tail folded.
 *
 * Sorted so the largest expense always takes the first colour: the palette
 * is assigned by rank here rather than by category identity, which is safe
 * only because this chart is never shown beside a second one it would have
 * to agree with. (A cross-story aggregate would need colour pinned to the
 * category instead -- see the note in globals.css.)
 */
export function resolveSlices(rows: ExpenseSlice[]): {
  slices: ResolvedSlice[];
  totalCents: number;
} {
  const usable = rows.filter((row) => row.cents > 0);
  const totalCents = usable.reduce((sum, row) => sum + row.cents, 0);
  if (totalCents === 0) return { slices: [], totalCents: 0 };

  const sorted = [...usable].sort((a, b) => b.cents - a.cents);
  const head =
    sorted.length > SLICE_COUNT ? sorted.slice(0, SLICE_COUNT - 1) : sorted;
  const tail = sorted.length > SLICE_COUNT ? sorted.slice(SLICE_COUNT - 1) : [];

  const combined: ExpenseSlice[] = [...head];
  if (tail.length > 0) {
    combined.push({
      label: "Smaller categories",
      cents: tail.reduce((sum, row) => sum + row.cents, 0),
    });
  }

  return {
    slices: combined.map((row, index) => ({
      ...row,
      color: `var(--expense-${index + 1})`,
      share: row.cents / totalCents,
    })),
    totalCents,
  };
}

/**
 * Three decimal places, and not one more.
 *
 * Math.cos/Math.sin are not guaranteed to give bit-identical results across
 * engines, so Node's render and the browser's produced coordinates that
 * differed in the 14th decimal ("...982328" vs "...982342"). Identical
 * geometry, different STRING -- which React reports as a hydration mismatch
 * on every render of the editor. Rounding makes both sides agree, and at a
 * 200-unit viewBox a thousandth of a unit is far below a pixel.
 */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function polar(angleTurns: number, radius: number) {
  // -0.25 turns puts 0 at 12 o'clock rather than 3 o'clock.
  const radians = (angleTurns - 0.25) * 2 * Math.PI;
  return {
    x: round(CENTER + radius * Math.cos(radians)),
    y: round(CENTER + radius * Math.sin(radians)),
  };
}

/** One donut segment: out along the outer arc, back along the inner one. */
function arcPath(startTurns: number, endTurns: number): string {
  const largeArc = endTurns - startTurns > 0.5 ? 1 : 0;
  const outerStart = polar(startTurns, OUTER_R);
  const outerEnd = polar(endTurns, OUTER_R);
  const innerEnd = polar(endTurns, INNER_R);
  const innerStart = polar(startTurns, INNER_R);
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${OUTER_R} ${OUTER_R} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${INNER_R} ${INNER_R} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    "Z",
  ].join(" ");
}

/** 12% -> "12%", but never a bare "0%" for something that is really there. */
function formatShare(share: number): string {
  const percent = share * 100;
  if (percent > 0 && percent < 1) return "<1%";
  return `${Math.round(percent)}%`;
}

/**
 * How the ring and its legend sit relative to each other.
 *
 * "stacked" is the editor's arrangement: the ring above its legend, in a
 * narrow right-hand column that already sits beside the amount inputs, so
 * the side-by-side reading comes from the page rather than from here.
 *
 * "beside" is for surfaces with no list of their own to sit next to -- the
 * public story page -- where stacking made the figure read as one tall,
 * oversized block. Here the ring takes a fixed narrow column and the legend
 * runs alongside it. Below `sm` both variants stack, because 375px has room
 * for one column and no more.
 */
export type ExpenseDonutLayout = "stacked" | "beside";

export function ExpenseDonut({
  rows,
  layout = "stacked",
}: {
  rows: ExpenseSlice[];
  layout?: ExpenseDonutLayout;
}) {
  const beside = layout === "beside";
  const { slices, totalCents } = resolveSlices(rows);

  if (slices.length === 0) {
    return (
      <div className="flex min-h-48 items-center justify-center rounded-md border border-dashed border-border-subtle p-6">
        <p className="text-center text-sm text-muted-foreground">
          Add a category and an amount to see where your money went.
        </p>
      </div>
    );
  }

  // Cumulative offsets as a fold rather than a mutable cursor: a `let`
  // reassigned during render trips the React Compiler's "Cannot reassign
  // variable after render completes" rule, which this component hit for
  // real.
  const drawn = slices.reduce<
    Array<ResolvedSlice & { start: number; end: number }>
  >((acc, slice) => {
    const start = acc.length === 0 ? 0 : acc[acc.length - 1].end;
    acc.push({ ...slice, start, end: start + slice.share });
    return acc;
  }, []);

  return (
    <figure
      className={`m-0 ${beside ? "sm:flex sm:items-center sm:gap-6" : ""}`}
    >
      <div className={`relative ${beside ? "sm:w-40 sm:shrink-0" : ""}`}>
        <svg
          viewBox={`0 0 ${BOX} ${BOX}`}
          className={`mx-auto block h-auto w-full ${beside ? "max-w-40" : "max-w-56"}`}
          role="presentation"
          aria-hidden="true"
        >
          {/* A lone slice is a full turn, which an arc cannot express (its
              start and end points coincide and the path collapses). Draw
              the ring as a stroked circle instead. */}
          {drawn.length === 1 ? (
            <circle
              cx={CENTER}
              cy={CENTER}
              r={(OUTER_R + INNER_R) / 2}
              fill="none"
              stroke={drawn[0].color}
              strokeWidth={OUTER_R - INNER_R}
            />
          ) : (
            drawn.map((slice) => (
              <path
                key={slice.label}
                d={arcPath(slice.start, slice.end)}
                fill={slice.color}
                // 2px of the surface between fills, so adjacent slices read
                // as separate marks rather than one blended band.
                stroke="var(--surface)"
                strokeWidth={2}
              />
            ))
          )}
        </svg>

        {/* The total, in the hole the donut exists to provide. Ink tokens,
            not a series colour -- text never carries series identity. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xs text-muted-foreground">Broken down</span>
          <span className="text-base font-semibold">
            {formatNzdCents(totalCents)}
          </span>
        </div>
      </div>

      {/* Always present for >= 2 slices, and it is what makes the figure
          readable without colour: the swatch is beside the name, never
          instead of it. */}
      <figcaption
        className={`mt-3 ${beside ? "sm:mt-0 sm:min-w-0 sm:flex-1" : ""}`}
      >
        <ul className="space-y-1.5">
          {drawn.map((slice) => (
            <li
              key={slice.label}
              className="flex items-baseline gap-2 text-sm leading-tight"
            >
              <span
                aria-hidden="true"
                className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: slice.color }}
              />
              <span className="min-w-0 flex-1 truncate">{slice.label}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {formatShare(slice.share)}
              </span>
              <span className="shrink-0 tabular-nums">
                {formatNzdCents(slice.cents)}
              </span>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
