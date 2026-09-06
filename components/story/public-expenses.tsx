import { ExpenseDonut } from "@/components/story/expense-donut";
import {
  expensePerMonth,
  formatMonths,
  formatNzdCents,
} from "@/lib/story/expense-per-month";

/**
 * What one trip cost, on the public story page.
 *
 * Replaces the single "Traveller-reported cost: NZ$X" line that was the only
 * thing a reader could see about money. The breakdown has been enterable
 * since 20260902110100 and readable from get_published_story() since
 * 20260903120000; this is the first surface that shows it.
 *
 * A SERVER COMPONENT, deliberately. Nothing here is interactive, and both
 * pieces it leans on were built without React state or a Supabase import for
 * exactly this reason: `expensePerMonth()` is arithmetic and `ExpenseDonut`
 * is arc maths, so the public page reuses them unchanged rather than growing
 * a second implementation that could disagree with the editor's.
 *
 * ENGINEERING RULE 17 IS THE WHOLE FRAME. This is the part of a story a
 * reader is most likely to mistake for advice -- a number is easy to read as
 * "this is the budget" in a way prose is not. So the heading says whose
 * money it was, the per-month line says what it is derived from, and the
 * closing line says plainly that it is one person's record and not an
 * estimate for anyone else. None of that is decoration; it is the same
 * commitment the personal-experience label makes, applied where it is
 * easiest to forget.
 */

export type PublicExpense = {
  name: string;
  amount_nzd_cents: number;
  note: string | null;
};

export function PublicExpenses({
  totalCents,
  tripStartDate,
  tripEndDate,
  expenses,
}: {
  totalCents: number | null;
  tripStartDate: string | null;
  tripEndDate: string | null;
  expenses: PublicExpense[];
}) {
  const breakdown = expenses.filter((e) => e.amount_nzd_cents > 0);

  // Nothing recorded: render nothing at all rather than an empty section
  // announcing an absence. Most stories will not have this.
  if (totalCents == null && breakdown.length === 0) return null;

  const perMonth = expensePerMonth({
    startDate: tripStartDate,
    endDate: tripEndDate,
    totalCents,
  });

  // The note is the contributor's own gloss on a category ("Other" is the
  // common case). Folding it into the label keeps it beside the figure it
  // explains, and needs no change to the donut the editor also uses.
  const slices = breakdown.map((e) => ({
    label: e.note ? `${e.name} — ${e.note}` : e.name,
    cents: e.amount_nzd_cents,
  }));

  return (
    <section
      aria-labelledby="story-expenses-heading"
      className="mt-10 border-t border-border-subtle pt-6"
    >
      <h2
        id="story-expenses-heading"
        className="text-xl font-semibold tracking-tight"
      >
        What this trip cost
      </h2>

      {totalCents != null && (
        <p className="mt-2">
          <span className="text-2xl font-semibold">
            {formatNzdCents(totalCents)}
          </span>{" "}
          <span className="text-sm text-foreground/60">
            reported for the whole trip
          </span>
        </p>
      )}

      {/* Derived from the trip dates above, never stored. Silent when the
          trip has no date range, or is too short for a monthly figure to
          describe anything real -- see lib/story/expense-per-month.ts, which
          would rather show nothing than a confident extrapolation. */}
      {perMonth.kind === "ok" && (
        <p className="mt-1 text-sm text-foreground/60">
          About{" "}
          <strong className="font-medium text-foreground">
            {formatNzdCents(perMonth.perMonthCents)}
          </strong>{" "}
          a month across {formatMonths(perMonth.months)} months.
        </p>
      )}

      {/* `beside`, not the editor's stacked default: there is no list of
          inputs here for the ring to sit next to, so stacking made the
          figure read as one tall oversized block. The ring keeps a narrow
          fixed column and its legend runs alongside. */}
      {slices.length > 0 && (
        <div className="mt-6">
          <ExpenseDonut rows={slices} layout="beside" />
        </div>
      )}

      <p className="mt-6 text-xs text-foreground/60">
        These are the figures one traveller recorded for their own trip. They
        are a personal account, not a budget or an estimate — costs vary a lot
        by region, season, and how you travel.
      </p>
    </section>
  );
}
