import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExpenseDonut, resolveSlices } from "./expense-donut";

describe("resolveSlices", () => {
  it("sorts descending so the largest expense takes the first colour", () => {
    const { slices } = resolveSlices([
      { label: "Food", cents: 20_000 },
      { label: "Flights", cents: 90_000 },
      { label: "Rent", cents: 50_000 },
    ]);
    expect(slices.map((s) => s.label)).toEqual(["Flights", "Rent", "Food"]);
    expect(slices[0].color).toBe("var(--expense-1)");
    expect(slices[2].color).toBe("var(--expense-3)");
  });

  it("drops zero and negative rows rather than drawing empty slices", () => {
    const { slices, totalCents } = resolveSlices([
      { label: "Flights", cents: 90_000 },
      { label: "Bond", cents: 0 },
      { label: "Gear", cents: -100 },
    ]);
    expect(slices.map((s) => s.label)).toEqual(["Flights"]);
    expect(totalCents).toBe(90_000);
  });

  it("keeps exactly six categories as six slices", () => {
    const { slices } = resolveSlices(
      Array.from({ length: 6 }, (_, i) => ({
        label: `Cat ${i}`,
        cents: (6 - i) * 1000,
      })),
    );
    expect(slices).toHaveLength(6);
    expect(slices.some((s) => s.label === "Smaller categories")).toBe(false);
  });

  it("folds a seventh category into one 'Smaller categories' slice", () => {
    const { slices } = resolveSlices(
      Array.from({ length: 9 }, (_, i) => ({
        label: `Cat ${i}`,
        cents: (9 - i) * 1000,
      })),
    );
    // Never a seventh hue: five real slices plus the fold.
    expect(slices).toHaveLength(6);
    const last = slices[5];
    expect(last.label).toBe("Smaller categories");
    // Cats 5..8 = 4000 + 3000 + 2000 + 1000.
    expect(last.cents).toBe(10_000);
    expect(last.color).toBe("var(--expense-6)");
  });

  it("gives shares that sum to 1", () => {
    const { slices } = resolveSlices([
      { label: "Flights", cents: 30_000 },
      { label: "Rent", cents: 70_000 },
    ]);
    expect(slices.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1);
  });

  it("returns nothing when there is nothing to draw", () => {
    expect(resolveSlices([])).toEqual({ slices: [], totalCents: 0 });
    expect(resolveSlices([{ label: "Food", cents: 0 }]).slices).toHaveLength(0);
  });
});

describe("ExpenseDonut", () => {
  it("prompts instead of drawing an empty ring when there is no data", () => {
    render(<ExpenseDonut rows={[]} />);
    expect(screen.getByText(/see where your money went/i)).toBeInTheDocument();
  });

  it("labels every slice in text, so identity is never colour alone", () => {
    render(
      <ExpenseDonut
        rows={[
          { label: "Flights", cents: 90_000 },
          { label: "Rent", cents: 30_000 },
        ]}
      />,
    );
    expect(screen.getByText("Flights")).toBeInTheDocument();
    expect(screen.getByText("Rent")).toBeInTheDocument();
    expect(screen.getByText("$900.00")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
    // The total sits in the donut's hole.
    expect(screen.getByText("$1,200.00")).toBeInTheDocument();
  });

  it("shows <1% rather than rounding a real expense down to 0%", () => {
    render(
      <ExpenseDonut
        rows={[
          { label: "Flights", cents: 1_000_000 },
          { label: "Gear", cents: 100 },
        ]}
      />,
    );
    expect(screen.getByText("<1%")).toBeInTheDocument();
  });

  it("draws a single expense as a ring, not a collapsed arc", () => {
    const { container } = render(
      <ExpenseDonut rows={[{ label: "Flights", cents: 90_000 }]} />,
    );
    // A full-turn arc path collapses to nothing; a circle does not.
    expect(container.querySelector("circle")).not.toBeNull();
    expect(container.querySelector("path")).toBeNull();
  });

  it("hides the figure itself from assistive tech, leaving the legend", () => {
    const { container } = render(
      <ExpenseDonut rows={[{ label: "Flights", cents: 90_000 }]} />,
    );
    expect(container.querySelector("svg")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });
});

describe("ExpenseDonut layout", () => {
  const rows = [
    { label: "Flights", cents: 90_000 },
    { label: "Rent", cents: 30_000 },
  ];

  it("stacks by default, so the editor's usage is unchanged", () => {
    const { container } = render(<ExpenseDonut rows={rows} />);
    const figure = container.querySelector("figure")!;
    expect(figure.className).not.toMatch(/sm:flex/);
    // The editor's ring size.
    expect(container.querySelector("svg")!.className.baseVal).toMatch(
      /max-w-56/,
    );
  });

  it("puts the ring beside its legend, and smaller, when asked", () => {
    const { container } = render(<ExpenseDonut rows={rows} layout="beside" />);
    const figure = container.querySelector("figure")!;
    expect(figure.className).toMatch(/sm:flex/);
    expect(container.querySelector("svg")!.className.baseVal).toMatch(
      /max-w-40/,
    );
    // Below `sm` both variants stack: 375px has room for one column.
    expect(figure.className).toMatch(/sm:gap-6/);
  });

  it("says the same thing in both layouts", () => {
    // Layout is presentation only -- it must not change what a reader or a
    // screen reader gets.
    const stacked = render(<ExpenseDonut rows={rows} />).container.textContent;
    const beside = render(<ExpenseDonut rows={rows} layout="beside" />)
      .container.textContent;
    expect(beside).toBe(stacked);
  });
});
