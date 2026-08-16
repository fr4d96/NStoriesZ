import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StoryCard, type StoryCardData } from "./story-card";

const baseStory: StoryCardData = {
  story_id: "11111111-1111-4111-8111-111111111111",
  slug: "picking-apples-in-hawkes-bay",
  title: "Picking Apples in Hawke's Bay",
  excerpt: "Six weeks on an orchard, from dawn shifts to weekend hikes.",
  published_at: "2024-03-01T00:00:00.000Z",
  trip_year: 2023,
  travel_style: "budget",
  total_expense_nzd_cents: 850000,
  attribution_value: "Mei L.",
  contributor_slug: "mei-l",
  cover_image_path: null,
  regions: [{ region_name: "Hawke's Bay", destination_name: "Hastings" }],
  tags: ["Fruit picking", "Rural"],
};

describe("StoryCard", () => {
  it("renders the approved card fields", () => {
    render(<StoryCard story={baseStory} />);

    expect(
      screen.getByRole("link", { name: /picking apples in hawke's bay/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/six weeks on an orchard/i)).toBeInTheDocument();
    expect(screen.getByText("Mei L.")).toBeInTheDocument();
    expect(screen.getByText("Fruit picking")).toBeInTheDocument();
    expect(screen.getByText("Rural")).toBeInTheDocument();
  });

  it("never renders a rating/score or a booking-style CTA (docs/design-brief.md anti-patterns)", () => {
    render(<StoryCard story={baseStory} />);

    expect(
      screen.queryByText(/\d(\.\d)?\s*(stars?|★)/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /explore now|book now/i }),
    ).not.toBeInTheDocument();
  });

  it("falls back to 'Anonymous' when attribution_value is null", () => {
    render(<StoryCard story={{ ...baseStory, attribution_value: null }} />);
    expect(screen.getByText("Anonymous")).toBeInTheDocument();
  });

  it("does not render a nested link for the contributor (avoids invalid nested <a>)", () => {
    const { container } = render(<StoryCard story={baseStory} />);
    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(1);
  });
});
