import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FeaturedStoryStack } from "@/components/home/featured-story-stack";
import type { StoryCardData } from "@/components/story/story-card";

function makeStory(overrides: Partial<StoryCardData> = {}): StoryCardData {
  return {
    story_id: "story-1",
    slug: "a-vineyard-season",
    title: "A vineyard season in Marlborough",
    excerpt: "Six weeks of pruning turned into the whole season.",
    published_at: "2026-01-01T00:00:00Z",
    trip_year: 2025,
    travel_style: "solo",
    total_expense_nzd_cents: null,
    attribution_value: "M. Lindqvist",
    contributor_slug: "m-lindqvist",
    cover_image_path: "stories/story-1/cover.jpg",
    regions: [{ region_name: "Marlborough", destination_name: "Blenheim" }],
    work_types: ["Viticulture"],
    tags: ["Seasonal work"],
    ...overrides,
  };
}

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

describe("FeaturedStoryStack", () => {
  it("renders nothing for an empty story list", () => {
    const { container } = render(<FeaturedStoryStack stories={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one card per story with a link to /stories/[slug]", () => {
    const stories = [
      makeStory({ story_id: "a", slug: "a-slug", title: "Story A" }),
      makeStory({ story_id: "b", slug: "b-slug", title: "Story B" }),
    ];
    const { container } = render(<FeaturedStoryStack stories={stories} />);
    expect(screen.getByText("Story A")).toBeInTheDocument();
    expect(screen.getByText("Story B")).toBeInTheDocument();
    const hrefs = Array.from(
      container.querySelectorAll('a[href^="/stories/"]'),
    ).map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual(
      expect.arrayContaining(["/stories/a-slug", "/stories/b-slug"]),
    );
  });

  it("renders the 'no photo' fallback when cover_image_path is null", () => {
    render(
      <FeaturedStoryStack stories={[makeStory({ cover_image_path: null })]} />,
    );
    expect(screen.getByText("No photo")).toBeInTheDocument();
  });

  it("handles malformed regions/work_types/tags without throwing", () => {
    expect(() =>
      render(
        <FeaturedStoryStack
          stories={[
            makeStory({
              regions: "not-an-array",
              work_types: { nope: true },
              tags: null,
            }),
          ]}
        />,
      ),
    ).not.toThrow();
  });

  it("advances to the next story when the Next button is clicked", () => {
    const stories = [
      makeStory({ story_id: "a", slug: "a", title: "Story A" }),
      makeStory({ story_id: "b", slug: "b", title: "Story B" }),
      makeStory({ story_id: "c", slug: "c", title: "Story C" }),
    ];
    render(<FeaturedStoryStack stories={stories} />);
    expect(screen.getByText(/Story 1 of 3: Story A/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next stories" }));
    expect(screen.getByText(/Story 2 of 3: Story B/)).toBeInTheDocument();
  });

  it("wraps to the last story when Previous is clicked at the start", () => {
    const stories = [
      makeStory({ story_id: "a", slug: "a", title: "Story A" }),
      makeStory({ story_id: "b", slug: "b", title: "Story B" }),
      makeStory({ story_id: "c", slug: "c", title: "Story C" }),
    ];
    render(<FeaturedStoryStack stories={stories} />);
    fireEvent.click(screen.getByRole("button", { name: "Previous stories" }));
    expect(screen.getByText(/Story 3 of 3: Story C/)).toBeInTheDocument();
  });

  it("moves the stack with the right/left arrow keys", async () => {
    const stories = [
      makeStory({ story_id: "a", slug: "a", title: "Story A" }),
      makeStory({ story_id: "b", slug: "b", title: "Story B" }),
    ];
    const { container } = render(<FeaturedStoryStack stories={stories} />);
    const region = container.querySelector("[tabindex='0']") as HTMLElement;
    fireEvent.keyDown(region, { key: "ArrowRight" });
    expect(screen.getByText(/Story 2 of 2: Story B/)).toBeInTheDocument();
    // The throw-animation lock briefly ignores further moves, matching the
    // real drag-throw animation -- wait it out before advancing again.
    await new Promise((resolve) => setTimeout(resolve, 550));
    fireEvent.keyDown(region, { key: "ArrowLeft" });
    expect(screen.getByText(/Story 1 of 2: Story A/)).toBeInTheDocument();
  });

  it("jumps to a story when its dot is clicked", () => {
    const stories = [
      makeStory({ story_id: "a", slug: "a", title: "Story A" }),
      makeStory({ story_id: "b", slug: "b", title: "Story B" }),
      makeStory({ story_id: "c", slug: "c", title: "Story C" }),
    ];
    render(<FeaturedStoryStack stories={stories} />);
    fireEvent.click(screen.getByRole("button", { name: "Go to story 3 of 3" }));
    expect(screen.getByText(/Story 3 of 3: Story C/)).toBeInTheDocument();
  });

  it("throws the active card left and advances when dragged past the threshold", () => {
    const stories = [
      makeStory({ story_id: "a", slug: "a", title: "Story A" }),
      makeStory({ story_id: "b", slug: "b", title: "Story B" }),
    ];
    const { getAllByTestId } = render(<FeaturedStoryStack stories={stories} />);
    const activeCard = getAllByTestId("stack-card").find(
      (card) => card.dataset.active === "true",
    ) as HTMLElement;
    fireEvent.pointerDown(activeCard, {
      button: 0,
      clientX: 200,
      pointerId: 1,
    });
    fireEvent.pointerMove(activeCard, { clientX: 0, pointerId: 1 });
    fireEvent.pointerUp(activeCard, { clientX: -150, pointerId: 1 });
    expect(screen.getByText(/Story 2 of 2: Story B/)).toBeInTheDocument();
  });

  it("snaps back without advancing on a small drag", () => {
    const stories = [
      makeStory({ story_id: "a", slug: "a", title: "Story A" }),
      makeStory({ story_id: "b", slug: "b", title: "Story B" }),
    ];
    const { getAllByTestId } = render(<FeaturedStoryStack stories={stories} />);
    const activeCard = getAllByTestId("stack-card").find(
      (card) => card.dataset.active === "true",
    ) as HTMLElement;
    fireEvent.pointerDown(activeCard, {
      button: 0,
      clientX: 200,
      pointerId: 1,
    });
    fireEvent.pointerMove(activeCard, { clientX: 210, pointerId: 1 });
    fireEvent.pointerUp(activeCard, { clientX: 215, pointerId: 1 });
    expect(screen.getByText(/Story 1 of 2: Story A/)).toBeInTheDocument();
  });
});
