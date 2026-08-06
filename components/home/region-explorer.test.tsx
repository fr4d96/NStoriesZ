import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RegionExplorer } from "@/components/home/region-explorer";
import type { StoryCardData } from "@/components/story/story-card";

const regions = [
  { id: "region-otago", name: "Otago" },
  { id: "region-wellington", name: "Wellington" },
  { id: "region-nelson", name: "Nelson" },
];
const destinations = [
  { id: "d1", name: "Queenstown", regionId: "region-otago" },
];

function makeStory(regionName: string): StoryCardData {
  return {
    story_id: regionName,
    slug: regionName,
    title: `A story in ${regionName}`,
    excerpt: null,
    published_at: "2026-01-01T00:00:00Z",
    trip_year: 2025,
    travel_style: null,
    total_expense_nzd_cents: null,
    attribution_value: null,
    contributor_slug: null,
    cover_image_path: null,
    regions: [{ region_name: regionName }],
    work_types: [],
    tags: [],
  };
}

describe("RegionExplorer", () => {
  it("renders nothing when no fetched story matches a real region", () => {
    const { container } = render(
      <RegionExplorer
        regions={regions}
        destinations={destinations}
        stories={[]}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("only shows regions that actually appear in the story batch", () => {
    render(
      <RegionExplorer
        regions={regions}
        destinations={destinations}
        stories={[makeStory("Otago")]}
      />,
    );
    expect(screen.getByRole("link", { name: /Otago/ })).toHaveAttribute(
      "href",
      "/stories?region=region-otago",
    );
    expect(screen.queryByText("Wellington")).not.toBeInTheDocument();
    expect(screen.queryByText("Nelson")).not.toBeInTheDocument();
  });

  it("lists that region's destinations", () => {
    render(
      <RegionExplorer
        regions={regions}
        destinations={destinations}
        stories={[makeStory("Otago")]}
      />,
    );
    expect(screen.getByText("Queenstown")).toBeInTheDocument();
  });
});
