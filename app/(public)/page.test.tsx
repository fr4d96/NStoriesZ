import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { listPublishedStories } from "@/lib/story/public-queries";

vi.mock("@/lib/story/public-queries", () => ({
  listPublishedStories: vi.fn(async () => []),
  listPublicRegions: vi.fn(async () => []),
  listPublicDestinations: vi.fn(async () => []),
}));

import HomePage from "./page";

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
  tags: ["Fruit picking"],
};

// A second, materially different record -- different region, different tags
// -- so the index's filter axes have something real to split on.
const otherStory = {
  ...fixtureStory,
  story_id: "2",
  slug: "story-two",
  title: "A winter on the Canterbury dairy run",
  excerpt: "Up at four, and colder than I expected.",
  trip_year: 2023,
  attribution_value: "Mei L.",
  contributor_slug: "mei-l",
  regions: [{ region_name: "Canterbury", destination_name: "Ashburton" }],
  tags: ["Farm work"],
};

function mockStories(...batch: unknown[]) {
  vi.mocked(listPublishedStories).mockResolvedValueOnce(
    batch as unknown as Awaited<ReturnType<typeof listPublishedStories>>,
  );
}

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
    expect(screen.queryByText("The record")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Not sure where to start reading?"),
    ).not.toBeInTheDocument();
  });

  it("still explains the model when there are no published stories", async () => {
    render(await HomePage());

    expect(
      screen.getByText("Why you can trust what you read here"),
    ).toBeInTheDocument();
  });

  it("renders the featured-story stack carousel when published stories exist", async () => {
    mockStories(fixtureStory);

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

  it("lists each published story as an index entry with its real metadata", async () => {
    mockStories(fixtureStory);

    render(await HomePage());

    const index = screen
      .getByText("The record")
      .closest("section") as HTMLElement;

    // The entry links to the story and exposes the fields it actually carries.
    const entry = within(index).getByRole("link", {
      name: /Six months picking fruit in Central Otago/,
    });
    expect(entry).toHaveAttribute("href", "/stories/story-one");
    expect(
      within(index).getAllByText("Queenstown, Otago").length,
    ).toBeGreaterThan(0);
    expect(within(index).getAllByText("2024").length).toBeGreaterThan(0);

    expect(within(index).getByText("1 ENTRY")).toBeInTheDocument();
    expect(
      within(index).getByRole("link", { name: /Browse the full catalogue/ }),
    ).toHaveAttribute("href", "/stories");
  });

  it("offers index filters built only from values present in the batch", async () => {
    mockStories(fixtureStory, otherStory);

    render(await HomePage());

    const index = screen
      .getByText("The record")
      .closest("section") as HTMLElement;

    const placeFilters = within(index).getByRole("group", {
      name: "Filter stories by place",
    });
    expect(
      within(placeFilters).getByRole("button", { name: "Otago" }),
    ).toBeInTheDocument();
    expect(
      within(placeFilters).getByRole("button", { name: "Canterbury" }),
    ).toBeInTheDocument();

    const topicFilters = within(index).getByRole("group", {
      name: "Filter stories by topic",
    });
    expect(
      within(topicFilters).getByRole("button", { name: "Fruit picking" }),
    ).toBeInTheDocument();
    expect(
      within(topicFilters).getByRole("button", { name: "Farm work" }),
    ).toBeInTheDocument();

    // A value the batch never mentions is never offered as a filter, and an
    // axis the batch can't populate at all never gets a row. Work types are
    // no longer an axis at all (retired 2026-08-16).
    expect(
      within(index).queryByRole("button", { name: "Ski-field work" }),
    ).not.toBeInTheDocument();
    expect(
      within(index).queryByRole("group", { name: "Filter stories by work" }),
    ).not.toBeInTheDocument();
  });

  it("hides a filter axis that cannot split the batch", async () => {
    // Both stories share one region, so filtering by it would return the
    // whole batch -- a control that does nothing.
    mockStories(fixtureStory, { ...otherStory, regions: fixtureStory.regions });

    render(await HomePage());

    const index = screen
      .getByText("The record")
      .closest("section") as HTMLElement;

    expect(
      within(index).queryByRole("group", { name: "Filter stories by place" }),
    ).not.toBeInTheDocument();
  });

  it("narrows the index to the chosen filter", async () => {
    const user = userEvent.setup();
    mockStories(fixtureStory, otherStory);

    render(await HomePage());

    const index = screen
      .getByText("The record")
      .closest("section") as HTMLElement;
    expect(within(index).getByText("2 ENTRIES")).toBeInTheDocument();

    const placeFilters = within(index).getByRole("group", {
      name: "Filter stories by place",
    });
    await user.click(
      within(placeFilters).getByRole("button", { name: "Canterbury" }),
    );

    expect(within(index).getByText(/^1 ENTRY/)).toBeInTheDocument();
    expect(
      within(index).getByRole("link", {
        name: /A winter on the Canterbury dairy run/,
      }),
    ).toBeInTheDocument();
    expect(
      within(index).queryByRole("link", {
        name: /Six months picking fruit in Central Otago/,
      }),
    ).not.toBeInTheDocument();
  });

  it("renders the destination quiz when stories exist", async () => {
    mockStories(fixtureStory);

    render(await HomePage());

    expect(
      screen.getByText("Not sure where to start reading?"),
    ).toBeInTheDocument();
  });
});

describe("the record — pagination", () => {
  /** `count` stories, all in one region/tag so no filter axis appears. */
  function batchOf(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      ...fixtureStory,
      story_id: `p${i + 1}`,
      slug: `paged-${i + 1}`,
      title: `Paged story ${i + 1}`,
    }));
  }

  function recordSection() {
    return screen.getByText("The record").closest("section") as HTMLElement;
  }

  it("shows at most five entries at first view", async () => {
    mockStories(...batchOf(12));

    render(await HomePage());
    const index = within(recordSection());

    expect(index.getByText("Paged story 1")).toBeInTheDocument();
    expect(index.getByText("Paged story 5")).toBeInTheDocument();
    expect(index.queryByText("Paged story 6")).not.toBeInTheDocument();
    // The count still reports the whole record, not the page.
    expect(index.getByText(/12 ENTRIES/)).toBeInTheDocument();
    expect(index.getByText(/SHOWING 1–5/)).toBeInTheDocument();
  });

  it("does not paginate a record that fits on one page", async () => {
    mockStories(...batchOf(5));

    render(await HomePage());
    const index = within(recordSection());

    expect(index.getByText("Paged story 5")).toBeInTheDocument();
    expect(
      index.queryByRole("navigation", { name: "Record pages" }),
    ).not.toBeInTheDocument();
  });

  it("moves to the next page of entries", async () => {
    const user = userEvent.setup();
    mockStories(...batchOf(12));

    render(await HomePage());
    const index = within(recordSection());

    await user.click(index.getByRole("button", { name: "Next page" }));

    expect(index.queryByText("Paged story 5")).not.toBeInTheDocument();
    expect(index.getByText("Paged story 6")).toBeInTheDocument();
    expect(index.getByText("Paged story 10")).toBeInTheDocument();
    expect(index.getByText(/SHOWING 6–10/)).toBeInTheDocument();
  });

  // The numerals are the index's spine -- entry 06 has to stay entry 06 on
  // page two rather than the page restarting the count at 01.
  it("keeps entry numbering continuous across pages", async () => {
    const user = userEvent.setup();
    mockStories(...batchOf(12));

    render(await HomePage());
    const index = within(recordSection());

    expect(index.getByText("01")).toBeInTheDocument();
    await user.click(index.getByRole("button", { name: "Page 2 of 3" }));
    expect(index.getByText("06")).toBeInTheDocument();
    expect(index.queryByText("01")).not.toBeInTheDocument();
  });

  it("disables Prev on the first page and Next on the last", async () => {
    const user = userEvent.setup();
    mockStories(...batchOf(12));

    render(await HomePage());
    const index = within(recordSection());

    expect(index.getByRole("button", { name: "Previous page" })).toBeDisabled();
    await user.click(index.getByRole("button", { name: "Page 3 of 3" }));
    expect(index.getByRole("button", { name: "Next page" })).toBeDisabled();
    expect(index.getByRole("button", { name: "Previous page" })).toBeEnabled();
  });

  it("marks the current page for assistive technology", async () => {
    const user = userEvent.setup();
    mockStories(...batchOf(12));

    render(await HomePage());
    const index = within(recordSection());

    expect(index.getByRole("button", { name: "Page 1 of 3" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await user.click(index.getByRole("button", { name: "Page 2 of 3" }));
    expect(index.getByRole("button", { name: "Page 2 of 3" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      index.getByRole("button", { name: "Page 1 of 3" }),
    ).not.toHaveAttribute("aria-current");
  });

  // Narrowing the record while on a later page must not strand the reader
  // on a page the filtered list no longer has.
  it("returns to the first page when a filter changes", async () => {
    const user = userEvent.setup();
    // 6 Otago stories + 1 Canterbury: two pages, and a place axis that can
    // split them.
    mockStories(...batchOf(6), {
      ...otherStory,
      story_id: "c1",
      slug: "cant-1",
      title: "Canterbury one",
    });

    render(await HomePage());
    const index = within(recordSection());

    await user.click(index.getByRole("button", { name: "Page 2 of 2" }));
    expect(index.getByText(/SHOWING 6–7/)).toBeInTheDocument();

    const placeFilters = index.getByRole("group", {
      name: "Filter stories by place",
    });
    await user.click(
      within(placeFilters).getByRole("button", { name: "Canterbury" }),
    );

    expect(index.getByText("Canterbury one")).toBeInTheDocument();
    expect(index.getByText(/1 ENTRY/)).toBeInTheDocument();
  });
});
