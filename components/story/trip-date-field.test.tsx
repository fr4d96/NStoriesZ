import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  TripDateField,
  formatCalendarDate,
  parseCalendarDate,
  tripDurationDays,
  type TripDateMode,
} from "./trip-date-field";

function setup(
  overrides: Partial<{
    mode: TripDateMode;
    startDate: string;
    endDate: string;
    year: string;
  }> = {},
) {
  const handlers = {
    onModeChange: vi.fn<(mode: TripDateMode) => void>(),
    onStartDateChange: vi.fn<(value: string) => void>(),
    onEndDateChange: vi.fn<(value: string) => void>(),
    onYearChange: vi.fn<(value: string) => void>(),
  };
  render(
    <TripDateField
      mode={overrides.mode ?? "range"}
      startDate={overrides.startDate ?? ""}
      endDate={overrides.endDate ?? ""}
      year={overrides.year ?? ""}
      {...handlers}
    />,
  );
  return handlers;
}

/**
 * Mirrors how StoryEditForm drives the control: the parent owns the value and
 * pushes it back down. Lets a test type into a real date input and observe the
 * value the parent would hand to scheduleSave.
 */
function StatefulHarness({
  initialMode = "range",
  onStartDate,
  onYear,
}: {
  initialMode?: TripDateMode;
  onStartDate?: (value: string) => void;
  onYear?: (value: string) => void;
}) {
  const [mode, setMode] = useState<TripDateMode>(initialMode);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [year, setYear] = useState("");
  return (
    <TripDateField
      mode={mode}
      startDate={startDate}
      endDate={endDate}
      year={year}
      onModeChange={setMode}
      onStartDateChange={(value) => {
        setStartDate(value);
        onStartDate?.(value);
      }}
      onEndDateChange={setEndDate}
      onYearChange={(value) => {
        setYear(value);
        onYear?.(value);
      }}
    />
  );
}

describe("TripDateField — date maths", () => {
  it("parses a calendar date in UTC, so it never shifts by a day", () => {
    const ms = parseCalendarDate("2025-03-14");
    expect(ms).toBe(Date.UTC(2025, 2, 14));
  });

  it("rejects a well-shaped but impossible date instead of rolling it over", () => {
    expect(parseCalendarDate("2025-02-30")).toBeNull();
    expect(parseCalendarDate("2025-13-01")).toBeNull();
    expect(parseCalendarDate("2025-3-4")).toBeNull();
    expect(parseCalendarDate("")).toBeNull();
  });

  it("formats a stored date without touching the stored value", () => {
    expect(formatCalendarDate("2025-03-14")).toBe("14 Mar 2025");
    expect(formatCalendarDate("not-a-date")).toBeNull();
  });

  it("counts trip length inclusively, and refuses an inverted range", () => {
    expect(tripDurationDays("2025-03-14", "2025-03-14")).toBe(1);
    expect(tripDurationDays("2025-03-14", "2025-03-16")).toBe(3);
    // Across a DST boundary in most zones — UTC maths must not lose an hour.
    expect(tripDurationDays("2025-03-01", "2025-04-01")).toBe(32);
    expect(tripDurationDays("2025-03-16", "2025-03-14")).toBeNull();
    expect(tripDurationDays("2025-03-14", "")).toBeNull();
  });
});

describe("TripDateField — mode switch", () => {
  it("renders the two modes as one real radio group, not two loose radios", () => {
    setup();
    const specific = screen.getByRole("radio", { name: /specific dates/i });
    const justYear = screen.getByRole("radio", { name: /just the year/i });

    expect(specific).toBeChecked();
    expect(justYear).not.toBeChecked();
    // The bug this replaced: no shared `name`, so they were not a group.
    expect(specific.getAttribute("name")).toBeTruthy();
    expect(specific.getAttribute("name")).toBe(justYear.getAttribute("name"));
    expect(screen.getByRole("radiogroup")).toBeInTheDocument();
  });

  it("reports a mode change once, with the mode the caller stores", async () => {
    const user = userEvent.setup();
    const { onModeChange } = setup();

    await user.click(screen.getByRole("radio", { name: /just the year/i }));

    expect(onModeChange).toHaveBeenCalledTimes(1);
    expect(onModeChange).toHaveBeenCalledWith("year");
  });

  it("swaps the two date fields for the year field", () => {
    setup({ mode: "year", year: "2024" });

    expect(screen.queryByLabelText(/trip start date/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/trip year/i)).toHaveValue(2024);
  });

  it("moves between the two modes with the arrow keys, natively", async () => {
    const user = userEvent.setup();
    const { onModeChange } = setup();

    await user.tab();
    expect(
      screen.getByRole("radio", { name: /specific dates/i }),
    ).toHaveFocus();

    await user.keyboard("{ArrowRight}");

    // Native radio-group traversal both moves focus AND selects.
    expect(screen.getByRole("radio", { name: /just the year/i })).toHaveFocus();
    expect(onModeChange).toHaveBeenCalledWith("year");
  });

  it("puts the whole control on one tab stop, as a radio group should", async () => {
    const user = userEvent.setup();
    setup();

    await user.tab();
    expect(
      screen.getByRole("radio", { name: /specific dates/i }),
    ).toHaveFocus();

    await user.tab();
    // Straight past the unchecked radio into the first date field.
    expect(screen.getByLabelText(/trip start date/i)).toHaveFocus();
  });
});

describe("TripDateField — values handed back", () => {
  it("keeps both date fields native, so phones get the OS picker", () => {
    setup();
    expect(screen.getByLabelText(/trip start date/i)).toHaveAttribute(
      "type",
      "date",
    );
    expect(screen.getByLabelText(/trip end date/i)).toHaveAttribute(
      "type",
      "date",
    );
  });

  it("reports a typed date as an unmodified YYYY-MM-DD string", async () => {
    const user = userEvent.setup();
    const onStartDate = vi.fn();
    render(<StatefulHarness onStartDate={onStartDate} />);

    await user.type(screen.getByLabelText(/trip start date/i), "2025-03-14");

    expect(onStartDate).toHaveBeenLastCalledWith("2025-03-14");
    expect(screen.getByLabelText(/trip start date/i)).toHaveValue("2025-03-14");
  });

  it("reports the year as the raw field string, for the caller to Number()", async () => {
    const user = userEvent.setup();
    const onYear = vi.fn();
    render(<StatefulHarness initialMode="year" onYear={onYear} />);

    await user.type(screen.getByLabelText(/trip year/i), "2024");

    expect(onYear).toHaveBeenLastCalledWith("2024");
    expect(typeof onYear.mock.lastCall?.[0]).toBe("string");
  });

  it("bounds the year field to the range the schema accepts", () => {
    setup({ mode: "year" });
    const input = screen.getByLabelText(/trip year/i);
    expect(input).toHaveAttribute("min", "2000");
    expect(input).toHaveAttribute("max", "2100");
  });
});

describe("TripDateField — range readback", () => {
  it("says nothing while the range is half-filled", () => {
    setup({ startDate: "2025-03-14" });
    expect(screen.queryByText(/day/)).not.toBeInTheDocument();
  });

  it("reads a complete range back with an inclusive day count", () => {
    setup({ startDate: "2025-03-14", endDate: "2025-11-02" });
    expect(screen.getByText("14 Mar 2025")).toBeInTheDocument();
    expect(screen.getByText("2 Nov 2025")).toBeInTheDocument();
    expect(screen.getByText("234 days")).toBeInTheDocument();
  });

  it("says '1 day' for a single-day trip, not '1 days'", () => {
    setup({ startDate: "2025-03-14", endDate: "2025-03-14" });
    expect(screen.getByText("1 day")).toBeInTheDocument();
  });

  it("echoes the schema's own wording when the range is inverted", () => {
    setup({ startDate: "2025-11-02", endDate: "2025-03-14" });
    expect(
      screen.getByText(/must be on or before the end date/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/days$/)).not.toBeInTheDocument();
  });
});
