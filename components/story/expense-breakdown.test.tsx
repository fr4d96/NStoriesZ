import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  ExpenseBreakdown,
  expenseRowsToPayload,
  breakdownTotalDollars,
  type ExpenseDraftRow,
} from "./expense-breakdown";
import type { ActiveExpenseCategory } from "@/lib/story/active-lookups";

const categories: ActiveExpenseCategory[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Flights",
    slug: "flights",
    description: "Flights to and from New Zealand.",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Vehicle",
    slug: "vehicle",
    description: null,
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Other",
    slug: "other",
    description: null,
  },
];

function row(overrides: Partial<ExpenseDraftRow> = {}): ExpenseDraftRow {
  return {
    categoryId: categories[0].id,
    name: "Flights",
    slug: "flights",
    amountDollars: "",
    note: "",
    ...overrides,
  };
}

function setup(rows: ExpenseDraftRow[] = [], totalExpenseDollars = "") {
  const onChange = vi.fn();
  render(
    <ExpenseBreakdown
      categories={categories}
      rows={rows}
      totalExpenseDollars={totalExpenseDollars}
      onChange={onChange}
    />,
  );
  return { onChange };
}

describe("expenseRowsToPayload", () => {
  // The rule that matters most for data quality: an empty box means "I
  // didn't record this", never "$0". Number("") is 0, not NaN, so without
  // an explicit guard an untouched row would be saved as a confident zero
  // and drag down every future average across stories.
  it("drops an empty amount rather than storing a zero", () => {
    expect(expenseRowsToPayload([row({ amountDollars: "" })])).toEqual([]);
    expect(expenseRowsToPayload([row({ amountDollars: "   " })])).toEqual([]);
  });

  it("keeps a real, explicit zero", () => {
    expect(expenseRowsToPayload([row({ amountDollars: "0" })])).toEqual([
      { categoryId: categories[0].id, amountNzdCents: 0, note: null },
    ]);
  });

  it("converts dollars to cents, rounding the way the headline total does", () => {
    expect(
      expenseRowsToPayload([row({ amountDollars: "2000" })])[0].amountNzdCents,
    ).toBe(200000);
    expect(
      expenseRowsToPayload([row({ amountDollars: "12.34" })])[0].amountNzdCents,
    ).toBe(1234);
    // Floating point: 19.99 * 100 is 1998.9999999999998 before rounding.
    expect(
      expenseRowsToPayload([row({ amountDollars: "19.99" })])[0].amountNzdCents,
    ).toBe(1999);
    // Sub-cent input is rounded, not truncated or rejected -- and it
    // rounds to 100, not 101, because 1.005 * 100 is 100.49999999999999 in
    // binary floating point. That is a quirk worth pinning rather than
    // fixing here: the headline "Total expenses" input uses the identical
    // Math.round(Number(x) * 100), so the two numbers on the same screen
    // agree. Changing it in one place only would be the actual bug.
    expect(
      expenseRowsToPayload([row({ amountDollars: "1.005" })])[0].amountNzdCents,
    ).toBe(100);
  });

  it("survives the partial states typing produces", () => {
    // These are what an amount box actually holds mid-keystroke. A row is
    // dropped while it is not yet a number and comes straight back on the
    // keystroke that makes it one -- it must never throw or save NaN.
    expect(expenseRowsToPayload([row({ amountDollars: "-" })])).toEqual([]);
    expect(expenseRowsToPayload([row({ amountDollars: "1e" })])).toEqual([]);
    expect(expenseRowsToPayload([row({ amountDollars: "abc" })])).toEqual([]);
    // A lone trailing decimal point is a valid partial number.
    expect(
      expenseRowsToPayload([row({ amountDollars: "12." })])[0].amountNzdCents,
    ).toBe(1200);
    expect(
      expenseRowsToPayload([row({ amountDollars: ".5" })])[0].amountNzdCents,
    ).toBe(50);
  });

  it("clamps a negative to zero rather than failing the save", () => {
    expect(
      expenseRowsToPayload([row({ amountDollars: "-40" })])[0].amountNzdCents,
    ).toBe(0);
  });

  it("normalises a note to null when it is blank", () => {
    expect(
      expenseRowsToPayload([row({ amountDollars: "10", note: "   " })])[0].note,
    ).toBeNull();
    expect(
      expenseRowsToPayload([row({ amountDollars: "10", note: " gear " })])[0]
        .note,
    ).toBe("gear");
  });
});

describe("ExpenseBreakdown", () => {
  it("starts collapsed on a draft with no breakdown yet", () => {
    setup();
    expect(
      screen.getByRole("button", { name: /break it down by category/i }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("starts open when the revision already has saved rows", () => {
    setup([row({ amountDollars: "2000" })]);
    expect(
      screen.getByRole("button", { name: /break it down by category/i }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("adds a row for a chosen category with an empty amount", async () => {
    const user = userEvent.setup();
    const { onChange } = setup();

    await user.click(
      screen.getByRole("button", { name: /break it down by category/i }),
    );
    await user.selectOptions(
      screen.getByLabelText(/add a category/i),
      categories[1].id,
    );

    expect(onChange).toHaveBeenCalledWith([
      {
        categoryId: categories[1].id,
        name: "Vehicle",
        slug: "vehicle",
        amountDollars: "",
        note: "",
      },
    ]);
  });

  it("never offers a category that is already in the breakdown", () => {
    // Already-saved rows mean the panel is open on arrival -- no click.
    setup([row({ amountDollars: "2000" })]);

    const select = screen.getByLabelText(/add a category/i);
    expect(
      within(select).queryByRole("option", { name: "Flights" }),
    ).not.toBeInTheDocument();
    expect(
      within(select).getByRole("option", { name: "Vehicle" }),
    ).toBeInTheDocument();
  });

  it("removes a row", async () => {
    const user = userEvent.setup();
    const { onChange } = setup([row({ amountDollars: "2000" })]);

    await user.click(
      screen.getByRole("button", {
        name: /remove flights from the breakdown/i,
      }),
    );

    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("offers a note field only on the Other category", async () => {
    setup([
      row({ amountDollars: "2000" }),
      row({
        categoryId: categories[2].id,
        name: "Other",
        slug: "other",
        amountDollars: "50",
      }),
    ]);
    expect(screen.getAllByLabelText(/what was this other cost/i)).toHaveLength(
      1,
    );
  });

  it("renders a row whose category has been retired from the options list", () => {
    // A retired (inactive) category is absent from `categories`, so the
    // row's own carried name is the only thing that can label it.
    setup([
      row({
        categoryId: "99999999-9999-4999-8999-999999999999",
        name: "Ski pass",
        slug: "ski-pass",
        amountDollars: "800",
      }),
    ]);
    expect(screen.getByText("Ski pass")).toBeInTheDocument();
  });

  it("says so when the categories add up to more than the stated total, without blocking anything", () => {
    setup([row({ amountDollars: "9000" })], "5000");
    expect(screen.getByText(/more than the total above/i)).toBeInTheDocument();
  });

  it("stays quiet on a partial breakdown, which is the normal case", () => {
    setup([row({ amountDollars: "2000" })], "9000");
    expect(
      screen.queryByText(/more than the total above/i),
    ).not.toBeInTheDocument();
  });

  it("ignores empty rows in the subtotal rather than counting them as zero", () => {
    setup([row({ amountDollars: "2000" }), row({ amountDollars: "" })]);
    expect(screen.getByText(/\$2,000\.00/)).toBeInTheDocument();
  });
});

describe("breakdownTotalDollars", () => {
  it("adds up the rows that will actually be saved", () => {
    expect(
      breakdownTotalDollars([
        row({ categoryId: "a", amountDollars: "2400" }),
        row({ categoryId: "b", amountDollars: "1800.50" }),
      ]),
    ).toBe("4200.5");
  });

  it("ignores a half-typed or empty amount instead of counting it as 0", () => {
    expect(
      breakdownTotalDollars([
        row({ categoryId: "a", amountDollars: "2400" }),
        row({ categoryId: "b", amountDollars: "" }),
        row({ categoryId: "c", amountDollars: "-" }),
      ]),
    ).toBe("2400");
  });

  it("returns an empty string for an empty breakdown, not '0'", () => {
    // Clearing the last row must clear the total, not park a $0 on the
    // story -- "I didn't record it" is not "it cost nothing".
    expect(breakdownTotalDollars([])).toBe("");
    expect(breakdownTotalDollars([row({ amountDollars: "" })])).toBe("");
  });

  it("agrees exactly with what expenseRowsToPayload would store", () => {
    const rows = [
      row({ categoryId: "a", amountDollars: "10.10" }),
      row({ categoryId: "b", amountDollars: "20.20" }),
    ];
    const storedCents = expenseRowsToPayload(rows).reduce(
      (sum, r) => sum + r.amountNzdCents,
      0,
    );
    expect(Math.round(Number(breakdownTotalDollars(rows)) * 100)).toBe(
      storedCents,
    );
  });
});
