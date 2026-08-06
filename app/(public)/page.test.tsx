import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  listPublishedStories,
  listPublicRegions,
  listPublicDestinations,
} from "@/lib/story/public-queries";

vi.mock("@/lib/story/public-queries", () => ({
  listPublishedStories: vi.fn(async () => []),
  listPublicRegions: vi.fn(async () => []),
  listPublicDestinations: vi.fn(async () => []),
}));

import HomePage from "./page";

// IntersectionObserver is stubbed globally in vitest.setup.ts for
// components/home/reveal.tsx.

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

const fixtureStory = {
  story_id: "1",
  slug: "story-one",
  title: "Six months picking fruit in Central Otago",
  excerpt: "I landed in Queenstown with no plan.",
  published_at: "2025-01-01T00:00:00.000Z",
  trip_year: 2024,
  travel_style: "backpacker",
  total_expense_nzd_cents: null,
  attribution_type: "display_name",
  attribution_value: "Aiman R.",
  contributor_slug: "aiman-r",
  cover_image_path: null,
  regions: [{ region_name: "Otago", destination_name: "Queenstown" }],
  work_types: ["Fruit picking"],
  tags: [],
};

describe("HomePage", () => {
  // The personal-experience/not-advice disclaimer is asserted separately in
  // components/site-footer.test.tsx -- SiteFooter renders it sitewide via
  // app/(public)/layout.tsx, which this test (rendering <HomePage /> in
  // isolation, not the full layout) never mounts.
  it("renders the platform's hero heading", async () => {
    render(await HomePage());

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /real stories from across aotearoa/i,
      }),
    ).toBeInTheDocument();
  });

  it("renders nothing for the story-driven sections when there are no published stories", async () => {
    render(await HomePage());

    expect(
      screen.queryByRole("region", {
        name: "Featured Working Holiday stories",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Find a story that matches your journey"),
    ).not.toBeInTheDocument();
  });

  it("renders the featured-story stack carousel when published stories exist", async () => {
    vi.mocked(listPublishedStories).mockResolvedValueOnce([
      fixtureStory,
    ] as unknown as Awaited<ReturnType<typeof listPublishedStories>>);

    render(await HomePage());

    expect(
      screen.getByRole("region", {
        name: "Featured Working Holiday stories",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("Six months picking fruit in Central Otago").length,
    ).toBeGreaterThan(0);
    const readLinks = screen.getAllByRole("link", { name: /Read story/ });
    expect(readLinks[0]).toHaveAttribute("href", "/stories/story-one");
  });

  it("renders the filter grid, region explorer, and quiz sections when stories exist", async () => {
    vi.mocked(listPublishedStories).mockResolvedValueOnce([
      fixtureStory,
    ] as unknown as Awaited<ReturnType<typeof listPublishedStories>>);
    vi.mocked(listPublicRegions).mockResolvedValueOnce([
      { id: "region-otago", name: "Otago" },
    ]);
    vi.mocked(listPublicDestinations).mockResolvedValueOnce([
      { id: "dest-queenstown", name: "Queenstown", regionId: "region-otago" },
    ]);

    render(await HomePage());

    expect(
      screen.getByText("Find a story that matches your journey"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Fruit picking" }),
    ).toBeInTheDocument();

    const regionSection = screen
      .getByText("Explore New Zealand by region")
      .closest("section") as HTMLElement;
    expect(
      within(regionSection).getByRole("link", { name: /Otago/ }),
    ).toHaveAttribute("href", "/stories?region=region-otago");

    expect(
      screen.getByText("Where should your working holiday take you?"),
    ).toBeInTheDocument();
  });
});
