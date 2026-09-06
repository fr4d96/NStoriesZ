import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { LoadingScreen, Skeleton, SkeletonText } from "./skeleton";
import StoriesLoading from "@/app/(public)/stories/loading";

describe("LoadingScreen", () => {
  it("announces once via role=status without printing a visible Loading line", () => {
    render(
      <LoadingScreen label="Loading stories">
        <Skeleton className="h-4 w-10" />
      </LoadingScreen>,
    );

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    // The word exists for screen readers only -- the visible feedback is the
    // progress hairline and the skeleton. A printed "Loading…" is what this
    // whole change removed.
    expect(screen.getByText("Loading stories")).toHaveClass("sr-only");
  });

  it("renders the route-progress hairline inside the delayed wrapper", () => {
    const { container } = render(
      <LoadingScreen>
        <Skeleton className="h-4 w-10" />
      </LoadingScreen>,
    );

    // .nf-loading holds the whole fallback at opacity 0 behind a 140ms delay,
    // so a fast navigation never paints a loading state at all.
    const wrapper = container.querySelector(".nf-loading");
    expect(wrapper).not.toBeNull();
    expect(wrapper?.querySelector(".nf-route-progress")).not.toBeNull();
  });
});

describe("Skeleton", () => {
  it("hides every placeholder from assistive tech", () => {
    const { container } = render(<SkeletonText lines={4} />);

    const blocks = container.querySelectorAll(".nf-skeleton");
    expect(blocks).toHaveLength(4);
    // A grid of a dozen placeholders announced individually is noise; the one
    // announcement belongs to LoadingScreen.
    for (const block of blocks) {
      expect(block).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("ends a run of text lines short, the way a real paragraph does", () => {
    const { container } = render(<SkeletonText lines={3} />);

    const blocks = Array.from(container.querySelectorAll(".nf-skeleton"));
    expect(blocks[0]).toHaveClass("w-full");
    expect(blocks[2]).toHaveClass("w-2/5");
  });
});

describe("route loading fallbacks", () => {
  it("shapes the /stories fallback like the page it stands in for", () => {
    const { container } = render(<StoriesLoading />);

    expect(screen.getByText("Loading stories")).toBeInTheDocument();
    // Six cards at the same 1/2/3-column breakpoints the real grid uses --
    // matching shapes are what stop the swap from shifting the layout.
    expect(
      container.querySelector(".grid.grid-cols-1.sm\\:grid-cols-2"),
    ).not.toBeNull();
  });

  /**
   * The actual bug this change fixed was file PLACEMENT, not styling: the only
   * loading.tsx used to sit at the root segment, above every route group, so
   * React swapped out the group layout with it and the header, nav and footer
   * disappeared on every navigation.
   *
   * Nothing in a render test can catch that regressing -- it is a property of
   * where the files are -- so assert the files themselves.
   */
  it("keeps a fallback inside every route group so the chrome survives navigation", () => {
    const appDir = path.join(process.cwd(), "app");
    const required = [
      "(public)/loading.tsx",
      "(public)/stories/loading.tsx",
      "(public)/stories/[id]/loading.tsx",
      "(public)/contributors/loading.tsx",
      "(public)/contributors/[slug]/loading.tsx",
      "(public)/costs/loading.tsx",
      "(auth)/loading.tsx",
      "(contributor)/loading.tsx",
      "(editor)/editorial/loading.tsx",
      "(moderation)/moderation/loading.tsx",
      "(admin)/admin/loading.tsx",
      "(readiness)/readiness/loading.tsx",
    ];

    for (const file of required) {
      expect(
        fs.existsSync(path.join(appDir, file)),
        `missing app/${file}`,
      ).toBe(true);
    }
  });
});
