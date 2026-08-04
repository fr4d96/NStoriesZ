import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/story/public-queries", () => ({
  listPublishedStories: vi.fn(async () => []),
}));

import HomePage from "./page";

describe("HomePage", () => {
  it("renders the platform's purpose and the personal-experience disclaimer", async () => {
    render(await HomePage());

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /working holiday stories from new zealand/i,
      }),
    ).toBeInTheDocument();

    expect(
      screen.getAllByText(
        /immigration, legal, employment, tax, or financial advice/i,
      ).length,
    ).toBeGreaterThan(0);
  });
});
