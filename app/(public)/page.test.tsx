import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HomePage from "./page";

describe("HomePage", () => {
  it("renders the platform's purpose and the personal-experience disclaimer", () => {
    render(<HomePage />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /working holiday stories from new zealand/i,
      }),
    ).toBeInTheDocument();

    expect(
      screen.getByText(/not immigration new zealand/i),
    ).toBeInTheDocument();
  });
});
