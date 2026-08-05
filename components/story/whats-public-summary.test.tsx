import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WhatsPublicSummary } from "./whats-public-summary";

describe("WhatsPublicSummary", () => {
  it("shows the exact attribution value and type", () => {
    render(
      <WhatsPublicSummary
        attributionType="pseudonym"
        attributionValue="Backpack Mei"
        hasExcerpt={true}
        imageCount={0}
        decorativeImageCount={0}
      />,
    );

    expect(screen.getByText("Backpack Mei")).toBeInTheDocument();
    expect(screen.getByText(/a pseudonym/i)).toBeInTheDocument();
  });

  it("does not mention images when there are none", () => {
    render(
      <WhatsPublicSummary
        attributionType="display_name"
        attributionValue="Mei"
        hasExcerpt={false}
        imageCount={0}
        decorativeImageCount={0}
      />,
    );

    expect(screen.queryByText(/image/i)).not.toBeInTheDocument();
  });

  it("mentions image count and captioned count", () => {
    render(
      <WhatsPublicSummary
        attributionType="real_name"
        attributionValue="Mei Lin"
        hasExcerpt={false}
        imageCount={3}
        decorativeImageCount={1}
      />,
    );

    expect(screen.getByText(/3 images/i)).toBeInTheDocument();
    expect(screen.getByText(/2 with a visible caption/i)).toBeInTheDocument();
  });

  it("never renders internal note content -- only its own fixed disclosure copy", () => {
    render(
      <WhatsPublicSummary
        attributionType="anonymous"
        attributionValue="Anonymous"
        hasExcerpt={false}
        imageCount={0}
        decorativeImageCount={0}
      />,
    );

    expect(
      screen.getByText(/internal editor and moderator notes are never shown/i),
    ).toBeInTheDocument();
  });
});
