import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SiteFooter } from "./site-footer";

describe("SiteFooter", () => {
  it("carries the not-Immigration-New-Zealand / personal-experience disclaimer sitewide", () => {
    render(<SiteFooter />);

    expect(screen.getByText(/not affiliated with/i)).toBeInTheDocument();
    expect(screen.getByText(/personal experience/i)).toBeInTheDocument();
  });

  it("links to all four legal placeholder pages", () => {
    render(<SiteFooter />);

    for (const label of [
      "Privacy",
      "Terms",
      "Community Guidelines",
      "Copyright & Removal",
    ]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
  });
});
