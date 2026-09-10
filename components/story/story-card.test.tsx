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
  contributor_avatar_emoji: null,
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

  it("passes the contributor's avatar emoji through to the attribution chip", () => {
    render(
      <StoryCard story={{ ...baseStory, contributor_avatar_emoji: "🛶" }} />,
    );

    expect(screen.getByText("🛶")).toBeInTheDocument();
  });

  it("falls back to the initial letter when the story carries no avatar emoji", () => {
    render(<StoryCard story={baseStory} />);

    expect(screen.getByText("M")).toBeInTheDocument();
  });

  // The row shape 20260910140000 returns for an anonymously-published story:
  // every identity marker nulled at the read boundary. This asserts the card
  // does the right thing with that shape -- no name, no byline link, no
  // avatar emoji -- which is what makes the SQL gate worth anything.
  it("renders an anonymous story with no name, no byline link and no emoji", () => {
    render(
      <StoryCard
        story={{
          ...baseStory,
          attribution_value: null,
          contributor_slug: null,
          contributor_avatar_emoji: null,
        }}
      />,
    );

    expect(screen.getByText("Anonymous")).toBeInTheDocument();
    expect(screen.queryByText("Mei L.")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /anonymous/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("🛶")).not.toBeInTheDocument();
    // Falls all the way back to the initial of the word actually shown.
    expect(screen.getByText("A")).toBeInTheDocument();
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
