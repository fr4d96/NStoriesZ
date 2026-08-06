import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DestinationQuiz } from "@/components/home/destination-quiz";
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
    regions: [{ region_name: "Otago" }],
    work_types: ["Viticulture"],
    tags: ["Solo travel", "South Island"],
    ...overrides,
  };
}

const regions = [{ id: "region-otago", name: "Otago" }];

describe("DestinationQuiz", () => {
  it("renders nothing for an empty story list", () => {
    const { container } = render(
      <DestinationQuiz stories={[]} regions={regions} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("walks through every question and shows a real region result", () => {
    render(<DestinationQuiz stories={[makeStory()]} regions={regions} />);

    fireEvent.click(screen.getByRole("button", { name: /Vineyard work/ }));
    fireEvent.click(screen.getByRole("button", { name: /Saving as much/ }));
    fireEvent.click(screen.getByRole("button", { name: /Just me/ }));
    fireEvent.click(screen.getByRole("button", { name: /South Island/ }));

    expect(screen.getByText("Otago")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Explore stories" }),
    ).toHaveAttribute("href", "/stories?region=region-otago");
  });

  it("supports going back to change an earlier answer", () => {
    render(<DestinationQuiz stories={[makeStory()]} regions={regions} />);
    fireEvent.click(screen.getByRole("button", { name: /Vineyard work/ }));
    expect(screen.getByText("2 / 4")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "← Back" }));
    expect(screen.getByText("1 / 4")).toBeInTheDocument();
  });

  it("falls back gracefully when nothing matches", () => {
    render(
      <DestinationQuiz
        stories={[
          makeStory({
            regions: [{ region_name: "Otago" }],
            work_types: [],
            tags: [],
          }),
        ]}
        regions={regions}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Farm work/ }));
    fireEvent.click(screen.getByRole("button", { name: /Saving as much/ }));
    fireEvent.click(screen.getByRole("button", { name: /Just me/ }));
    fireEvent.click(screen.getByRole("button", { name: /North Island/ }));

    expect(
      screen.getByText("We don't have a strong match yet"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Browse all stories" }),
    ).toHaveAttribute("href", "/stories");
  });

  it("restarts the quiz from the result screen", () => {
    render(<DestinationQuiz stories={[makeStory()]} regions={regions} />);
    fireEvent.click(screen.getByRole("button", { name: /Vineyard work/ }));
    fireEvent.click(screen.getByRole("button", { name: /Saving as much/ }));
    fireEvent.click(screen.getByRole("button", { name: /Just me/ }));
    fireEvent.click(screen.getByRole("button", { name: /South Island/ }));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("1 / 4")).toBeInTheDocument();
  });
});
