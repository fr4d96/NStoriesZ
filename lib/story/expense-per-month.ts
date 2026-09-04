/**
 * "What did that work out to per month?" -- derived, never stored.
 *
 * $10,000 over three months and $10,000 over twelve are wildly different
 * stories, and the raw total on its own cannot tell them apart. Trip length
 * is already recorded (story_revisions.trip_start_date / trip_end_date, both
 * calendar dates per Engineering Rule 9), so this is arithmetic at render
 * time: no new column, no new migration, and it works on every story that
 * already has a total, whether or not it has a category breakdown.
 *
 * Deliberately a pure module with no React and no Supabase import. The
 * editor uses it today; a public story page or a cross-story aggregate can
 * use the identical function later without any of this moving.
 *
 * NOT advice (Engineering Rule 17). This reports what one person spent
 * divided by how long they were there. It is not a forecast of what anyone
 * else's trip will cost, and the copy around it must not imply otherwise --
 * which is also why `too-short` exists below rather than silently returning
 * a confident-looking number.
 */

/**
 * Below this, a per-month figure is extrapolation dressed up as data:
 * $3,000 spent in 10 days is not "$9,132 a month", it is a fortnight of
 * setup costs with no monthly rhythm to speak of. 28 days is one lunar-ish
 * month -- the shortest window where "per month" describes something the
 * contributor actually lived through rather than a projection.
 */
export const MIN_TRIP_DAYS_FOR_PER_MONTH = 28;

/**
 * Average Gregorian month (365.2425 / 12). Using this rather than a flat 30
 * keeps a full 365-day trip at exactly 12.0 months instead of 12.2, which
 * is the case people notice -- a WHV is commonly a whole year.
 */
const AVERAGE_DAYS_PER_MONTH = 30.436875;

export type ExpensePerMonth =
  /** Enough information, long enough trip. */
  | { kind: "ok"; perMonthCents: number; months: number; days: number }
  /** Year-only story, missing/invalid dates, or end before start. */
  | { kind: "no-dates" }
  /** Real dates, but too short for the figure to mean anything. */
  | { kind: "too-short"; days: number }
  /** No total recorded (or zero) -- nothing to divide. */
  | { kind: "no-amount" };

/**
 * Parses a "YYYY-MM-DD" calendar date to a UTC epoch day count.
 *
 * Parsed as explicit UTC rather than via `new Date(str)` so the result can
 * never shift by a day across a DST boundary or in a non-UTC timezone --
 * these are calendar dates, not instants, and the contributor's browser
 * timezone must not change how long their trip was.
 */
function toUtcDayNumber(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const ms = Date.UTC(year, month - 1, day);
  const parsed = new Date(ms);
  // Rejects real-looking impossibilities (2026-02-30 rolls to March 2).
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return Math.floor(ms / 86_400_000);
}

/**
 * Trip length in days, counting BOTH endpoints -- a trip that starts and
 * ends on the same date lasted 1 day, not 0. Returns null if either date is
 * missing/malformed or the end precedes the start (which the database
 * already forbids via story_revisions_trip_date_order, but the editor asks
 * mid-typing, when a half-entered range is normal).
 */
export function tripDurationDays(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
): number | null {
  if (!startDate || !endDate) return null;
  const start = toUtcDayNumber(startDate);
  const end = toUtcDayNumber(endDate);
  if (start === null || end === null) return null;
  if (end < start) return null;
  return end - start + 1;
}

/**
 * The headline total spread across the trip's length.
 *
 * Takes the total in CENTS, matching how it is stored and how the editor
 * has already parsed it, so no second dollars->cents conversion exists to
 * drift from the first one.
 */
export function expensePerMonth(input: {
  startDate: string | null | undefined;
  endDate: string | null | undefined;
  totalCents: number | null | undefined;
}): ExpensePerMonth {
  const days = tripDurationDays(input.startDate, input.endDate);
  if (days === null) return { kind: "no-dates" };
  if (days < MIN_TRIP_DAYS_FOR_PER_MONTH) return { kind: "too-short", days };

  const total = input.totalCents;
  if (total === null || total === undefined || !Number.isFinite(total)) {
    return { kind: "no-amount" };
  }
  if (total <= 0) return { kind: "no-amount" };

  const months = days / AVERAGE_DAYS_PER_MONTH;
  return {
    kind: "ok",
    perMonthCents: Math.round(total / months),
    months,
    days,
  };
}

/** Cents -> "$1,234.50". One definition, shared by every expense surface. */
export function formatNzdCents(cents: number): string {
  return new Intl.NumberFormat("en-NZ", {
    style: "currency",
    currency: "NZD",
  }).format(cents / 100);
}

/**
 * Months -> "12" / "3.5", for prose like "across 12 months". One decimal
 * place at most: "11.8 months" is honest, "11.83 months" is false
 * precision about a number that came from two calendar dates.
 */
export function formatMonths(months: number): string {
  const rounded = Math.round(months * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
