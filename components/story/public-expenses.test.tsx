import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PublicExpenses } from "./public-expenses";

const YEAR = { tripStartDate: "2026-01-01", tripEndDate: "2026-12-31" };

describe("PublicExpenses", () => {
  it("renders nothing when the story recorded no money at all", () => {
    const { container } = render(
      <PublicExpenses
        totalCents={null}
        tripStartDate={null}
        tripEndDate={null}
        expenses={[]}
      />,
    );
    // An empty section announcing an absence is worse than no section: most
    // stories will never have this.
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a headline total on its own, with no breakdown", () => {
    render(<PublicExpenses totalCents={1_400_000} {...YEAR} expenses={[]} />);
    expect(screen.getByText("$14,000.00")).toBeInTheDocument();
    expect(
      screen.getByText(/reported for the whole trip/i),
    ).toBeInTheDocument();
  });

  it("derives a per-month figure from the trip dates", () => {
    render(<PublicExpenses totalCents={1_200_000} {...YEAR} expenses={[]} />);
    expect(screen.getByText(/a month across 12 months/i)).toBeInTheDocument();
  });

  it("stays silent about per-month when the story has no date range", () => {
    render(
      <PublicExpenses
        totalCents={1_200_000}
        tripStartDate={null}
        tripEndDate={null}
        expenses={[]}
      />,
    );
    expect(screen.queryByText(/a month across/i)).not.toBeInTheDocument();
  });

  it("stays silent about per-month on a trip too short to describe one", () => {
    render(
      <PublicExpenses
        totalCents={300_000}
        tripStartDate="2026-03-01"
        tripEndDate="2026-03-10"
        expenses={[]}
      />,
    );
    // $3,000 in 10 days is not "$9,132 a month" -- see expense-per-month.ts.
    expect(screen.queryByText(/a month across/i)).not.toBeInTheDocument();
  });

  it("renders the breakdown, folding a note in beside its category", () => {
    render(
      <PublicExpenses
        totalCents={500_000}
        {...YEAR}
        expenses={[
          { name: "Flights", amount_nzd_cents: 200_000, note: null },
          { name: "Other", amount_nzd_cents: 300_000, note: "Van repairs" },
        ]}
      />,
    );
    expect(screen.getByText("Flights")).toBeInTheDocument();
    expect(screen.getByText("Other — Van repairs")).toBeInTheDocument();
  });

  it("drops zero-amount rows rather than drawing empty slices", () => {
    render(
      <PublicExpenses
        totalCents={200_000}
        {...YEAR}
        expenses={[
          { name: "Flights", amount_nzd_cents: 200_000, note: null },
          { name: "Bond", amount_nzd_cents: 0, note: null },
        ]}
      />,
    );
    expect(screen.getByText("Flights")).toBeInTheDocument();
    expect(screen.queryByText("Bond")).not.toBeInTheDocument();
  });

  it("renders a breakdown even when no headline total was recorded", () => {
    render(
      <PublicExpenses
        totalCents={null}
        {...YEAR}
        expenses={[{ name: "Flights", amount_nzd_cents: 200_000, note: null }]}
      />,
    );
    expect(screen.getByText("Flights")).toBeInTheDocument();
    expect(
      screen.queryByText(/reported for the whole trip/i),
    ).not.toBeInTheDocument();
  });

  it("always says this is one person's record, not an estimate", () => {
    // Engineering Rule 17: money is the part of a story a reader is most
    // likely to mistake for advice.
    render(<PublicExpenses totalCents={1_400_000} {...YEAR} expenses={[]} />);
    expect(
      screen.getByText(/not a budget or an estimate/i),
    ).toBeInTheDocument();
  });
});
