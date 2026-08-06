import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StoryFilterGrid } from "@/components/home/story-filter-grid";
import type { StoryCardData } from "@/components/story/story-card";

function makeStory(overrides: Partial<StoryCardData> = {}): StoryCardData {
  return {
    story_id: "1",
    slug: "slug-1",
    title: "Story",
    excerpt: null,
    published_at: "2026-01-01T00:00:00Z",
    trip_year: 2025,
    travel_style: null,
    total_expense_nzd_cents: null,
    attribution_value: null,
    contributor_slug: null,
    cover_image_path: null,
    regions: [],
    work_types: [],
    tags: [],
    ...overrides,
  };
}

describe("StoryFilterGrid", () => {
  it("renders nothing for an empty story list", () => {
    const { container } = render(<StoryFilterGrid stories={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows an 'All stories' chip plus chips drawn from real work types/tags", () => {
    render(
      <StoryFilterGrid
        stories={[
          makeStory({
            story_id: "a",
            title: "Vineyard",
            work_types: ["Viticulture"],
          }),
          makeStory({
            story_id: "b",
            title: "Winter in Queenstown",
            tags: ["Ski season"],
          }),
        ]}
      />,
    );
    expect(
      screen.getByRole("button", { name: "All stories" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Viticulture" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Ski season" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Vineyard")).toBeInTheDocument();
    expect(screen.getByText("Winter in Queenstown")).toBeInTheDocument();
  });

  it("filters the grid when a chip is clicked", () => {
    render(
      <StoryFilterGrid
        stories={[
          makeStory({
            story_id: "a",
            title: "Vineyard",
            work_types: ["Viticulture"],
          }),
          makeStory({
            story_id: "b",
            title: "Farm",
            work_types: ["Agriculture"],
          }),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Viticulture" }));
    expect(screen.getByText("Vineyard")).toBeInTheDocument();
    expect(screen.queryByText("Farm")).not.toBeInTheDocument();
  });

  it("includes a link back to the full stories index", () => {
    render(<StoryFilterGrid stories={[makeStory()]} />);
    expect(
      screen.getByRole("link", { name: /Browse all stories/ }),
    ).toHaveAttribute("href", "/stories");
  });
});
