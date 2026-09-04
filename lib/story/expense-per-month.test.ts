import { describe, expect, it } from "vitest";
import {
  MIN_TRIP_DAYS_FOR_PER_MONTH,
  expensePerMonth,
  formatMonths,
  formatNzdCents,
  tripDurationDays,
} from "./expense-per-month";

describe("tripDurationDays", () => {
  it("counts both endpoints, so a same-day trip is 1 day", () => {
    expect(tripDurationDays("2026-03-01", "2026-03-01")).toBe(1);
  });

  it("counts a full non-leap year as 365 days", () => {
    expect(tripDurationDays("2026-01-01", "2026-12-31")).toBe(365);
  });

  it("counts a leap year as 366 days", () => {
    expect(tripDurationDays("2028-01-01", "2028-12-31")).toBe(366);
  });

  it("returns null when either date is missing", () => {
    expect(tripDurationDays(null, "2026-12-31")).toBeNull();
    expect(tripDurationDays("2026-01-01", undefined)).toBeNull();
    expect(tripDurationDays("", "")).toBeNull();
  });

  it("returns null when the end precedes the start", () => {
    expect(tripDurationDays("2026-12-31", "2026-01-01")).toBeNull();
  });

  it("returns null for malformed or impossible dates", () => {
    expect(tripDurationDays("2026-1-1", "2026-12-31")).toBeNull();
    expect(tripDurationDays("not-a-date", "2026-12-31")).toBeNull();
    // 2026-02-30 would silently roll to March 2 under a naive Date parse.
    expect(tripDurationDays("2026-02-30", "2026-12-31")).toBeNull();
    expect(tripDurationDays("2026-13-01", "2026-12-31")).toBeNull();
  });

  it("spans a DST boundary without losing or gaining a day", () => {
    // NZ daylight saving ends 2026-04-05; these are calendar dates and must
    // not shift with the viewer's timezone.
    expect(tripDurationDays("2026-04-01", "2026-04-30")).toBe(30);
  });
});

describe("expensePerMonth", () => {
  const year = { startDate: "2026-01-01", endDate: "2026-12-31" };

  it("divides the total across a full year", () => {
    const result = expensePerMonth({ ...year, totalCents: 1_200_000 });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    // 365 days is 11.99 average months, so slightly above a flat /12
    // ($1,000.00): 1_200_000 * 30.436875 / 365 = 100_066.4.
    expect(result.perMonthCents).toBe(100_066);
    expect(formatMonths(result.months)).toBe("12");
  });

  it("reports the same total over half the time as double per month", () => {
    const half = expensePerMonth({
      startDate: "2026-01-01",
      endDate: "2026-06-30",
      totalCents: 1_200_000,
    });
    const full = expensePerMonth({ ...year, totalCents: 1_200_000 });
    if (half.kind !== "ok" || full.kind !== "ok")
      throw new Error("expected ok");
    expect(half.perMonthCents).toBeGreaterThan(full.perMonthCents * 1.9);
  });

  it("is no-dates for a year-only story", () => {
    expect(
      expensePerMonth({
        startDate: null,
        endDate: null,
        totalCents: 1_200_000,
      }).kind,
    ).toBe("no-dates");
  });

  it("is no-dates before too-short when the range is backwards", () => {
    expect(
      expensePerMonth({
        startDate: "2026-12-31",
        endDate: "2026-01-01",
        totalCents: 1_200_000,
      }).kind,
    ).toBe("no-dates");
  });

  it("suppresses a trip shorter than the minimum rather than extrapolating", () => {
    const result = expensePerMonth({
      startDate: "2026-03-01",
      endDate: "2026-03-10",
      totalCents: 300_000,
    });
    expect(result).toEqual({ kind: "too-short", days: 10 });
  });

  it("allows a trip exactly at the minimum", () => {
    const result = expensePerMonth({
      startDate: "2026-03-01",
      // Inclusive counting: the 28th day.
      endDate: "2026-03-28",
      totalCents: 300_000,
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.days).toBe(MIN_TRIP_DAYS_FOR_PER_MONTH);
  });

  it("is no-amount when the total is missing, zero, or not finite", () => {
    expect(expensePerMonth({ ...year, totalCents: null }).kind).toBe(
      "no-amount",
    );
    expect(expensePerMonth({ ...year, totalCents: undefined }).kind).toBe(
      "no-amount",
    );
    // A recorded 0 is not a meaningful monthly figure to show.
    expect(expensePerMonth({ ...year, totalCents: 0 }).kind).toBe("no-amount");
    expect(expensePerMonth({ ...year, totalCents: NaN }).kind).toBe(
      "no-amount",
    );
  });

  it("treats a negative total as no-amount rather than showing a negative", () => {
    expect(expensePerMonth({ ...year, totalCents: -500 }).kind).toBe(
      "no-amount",
    );
  });
});

describe("formatNzdCents", () => {
  it("formats cents as NZD", () => {
    expect(formatNzdCents(123_450)).toBe("$1,234.50");
    expect(formatNzdCents(0)).toBe("$0.00");
  });
});

describe("formatMonths", () => {
  it("drops a trailing .0 and keeps at most one decimal", () => {
    expect(formatMonths(12)).toBe("12");
    expect(formatMonths(11.99)).toBe("12");
    expect(formatMonths(3.5)).toBe("3.5");
    expect(formatMonths(11.83)).toBe("11.8");
  });
});
