import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SiteFooter } from "./site-footer";

describe("SiteFooter", () => {
  it("carries the not-immigration/legal/financial-advice disclaimer sitewide", () => {
    render(<SiteFooter />);

    expect(
      screen.getByText(
        /does not provide immigration, legal, employment, tax, or financial advice/i,
      ),
    ).toBeInTheDocument();
  });

  it("links to all four legal placeholder pages", () => {
    render(<SiteFooter />);

    for (const label of [
      "Privacy",
      "Terms",
      "Guidelines",
      "Copyright & Removal",
    ]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
  });

  it("links to the real stories, contributors, and about routes", () => {
    render(<SiteFooter />);

    expect(screen.getByRole("link", { name: "Stories" })).toHaveAttribute(
      "href",
      "/stories",
    );
    expect(screen.getByRole("link", { name: "Contributors" })).toHaveAttribute(
      "href",
      "/contributors",
    );
  });
});
