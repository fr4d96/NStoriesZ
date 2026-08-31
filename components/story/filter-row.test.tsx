import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { ALL, FilterRow } from "./filter-row";

describe("FilterRow", () => {
  it("marks the active option pressed and reports a click", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <FilterRow
        label="Region"
        options={[ALL, "Otago", "Nelson"]}
        active="Otago"
        onChange={onChange}
      />,
    );

    const group = screen.getByRole("group", {
      name: "Filter stories by region",
    });
    expect(screen.getByRole("button", { name: "Otago" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Nelson" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    await user.click(within(group).getByRole("button", { name: "Nelson" }));
    expect(onChange).toHaveBeenCalledWith("Nelson");
  });
});
