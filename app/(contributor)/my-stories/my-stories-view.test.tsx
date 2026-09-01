import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MyStoriesView } from "./my-stories-view";
import { mintPreviewUrlAction } from "@/app/(contributor)/stories/[id]/media-actions";
import type { MyStoryWithCover } from "@/lib/story/contributor-queries";

// The thumbnail mints a short-lived signed preview URL through a Server
// Action; in a jsdom unit test there is no server, so the action is stubbed
// and only the component's own rendering is under test here.
vi.mock("@/app/(contributor)/stories/[id]/media-actions", () => ({
  mintPreviewUrlAction: vi.fn(async () => ({ url: "blob:signed-preview" })),
}));

// deleteDraftStoryAction ultimately imports lib/story/mutations.ts, which is
// marked "server-only" -- unimportable from this Client Component test the
// same way the thumbnail action above is, so it's stubbed rather than left
// to transitively pull in a real server module.
vi.mock("./actions", () => ({
  deleteDraftStoryAction: vi.fn(async () => ({ ok: true }) as const),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

function makeStory(overrides: Partial<MyStoryWithCover> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Picking apples in Hawke's Bay",
    excerpt: "Six weeks on an orchard.",
    lifecycle_status: "draft",
    current_draft_revision_id: "22222222-2222-4222-8222-222222222222",
    published_revision_id: null,
    version: 1,
    updated_at: "2026-08-01T00:00:00.000Z",
    regions: [],
    coverMediaId: "33333333-3333-4333-8333-333333333333",
    coverAltText: "An orchard at dawn",
    ...overrides,
  } as MyStoryWithCover;
}

// This test environment provides no localStorage, so stub a minimal
// in-memory one -- the view reads it synchronously through
// useSyncExternalStore and the "no stored preference" default is exactly
// what's under test.
let store: Record<string, string> = {};

beforeEach(() => {
  store = {};
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  });
});

describe("MyStoriesView", () => {
  it("defaults to list view when nothing is stored", () => {
    render(<MyStoriesView stories={[makeStory()]} />);

    expect(screen.getByRole("button", { name: "List view" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Grid view" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("honours a stored grid preference over the list default", () => {
    store["kaki-my-stories-view"] = "grid";

    render(<MyStoriesView stories={[makeStory()]} />);

    expect(screen.getByRole("button", { name: "Grid view" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("reuses the cached preview URL when switching between grid and list view, instead of re-minting it", async () => {
    // A mediaId not used by any other test in this file, and a cleared
    // call count -- the module-level preview URL cache in
    // story-cover-thumbnail.tsx is process-wide, so both must be isolated
    // from whatever earlier tests already minted/cached.
    vi.mocked(mintPreviewUrlAction).mockClear();
    const user = userEvent.setup();
    render(
      <MyStoriesView
        stories={[
          makeStory({ coverMediaId: "99999999-9999-4999-8999-999999999999" }),
        ]}
      />,
    );

    // List view passes no alt text (the title link alongside carries it
    // instead), which gives the resolved <img> an empty accessible name --
    // match on the mocked resolved URL instead of alt text or role.
    const findThumbnail = () =>
      waitFor(() => {
        const img = document.querySelector('img[src="blob:signed-preview"]');
        expect(img).toBeTruthy();
        return img as HTMLImageElement;
      });

    // Initial (list) render mints the URL once.
    await findThumbnail();
    expect(mintPreviewUrlAction).toHaveBeenCalledTimes(1);

    // Switching to grid remounts the thumbnail in a new <ul> subtree; it
    // should pick up the still-fresh cached URL rather than re-minting.
    await user.click(screen.getByRole("button", { name: "Grid view" }));
    await findThumbnail();
    expect(mintPreviewUrlAction).toHaveBeenCalledTimes(1);

    // And back to list -- still no additional mint.
    await user.click(screen.getByRole("button", { name: "List view" }));
    await findThumbnail();
    expect(mintPreviewUrlAction).toHaveBeenCalledTimes(1);
  });

  it("shows a cover thumbnail beside each title in list view", () => {
    render(
      <MyStoriesView
        stories={[
          makeStory(),
          makeStory({
            id: "44444444-4444-4444-8444-444444444444",
            title: "A vineyard season",
            coverMediaId: null,
          }),
        ]}
      />,
    );

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    // Every row leads with a thumbnail -- a real cover once its signed URL
    // resolves, or the no-image placeholder for a story that has none --
    // and it sits before the title in document order.
    for (const row of rows) {
      const thumb = row.querySelector("a[aria-hidden='true']");
      expect(thumb).not.toBeNull();
      expect(
        thumb!.compareDocumentPosition(
          within(row).getByRole("link", { name: /^(Preview|Review)/ }),
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    // A plain draft's title/thumbnail links straight to editing, not preview.
    expect(
      screen.getByRole("link", { name: "Picking apples in Hawke's Bay" }),
    ).toHaveAttribute(
      "href",
      "/stories/11111111-1111-4111-8111-111111111111/edit",
    );
  });

  it("sends a non-draft story's title/thumbnail to preview, not edit", () => {
    render(
      <MyStoriesView
        stories={[makeStory({ lifecycle_status: "published" })]}
      />,
    );

    expect(
      screen.getByRole("link", { name: "Picking apples in Hawke's Bay" }),
    ).toHaveAttribute(
      "href",
      "/stories/11111111-1111-4111-8111-111111111111/preview",
    );
  });

  it("offers Edit only where an edit would actually be accepted", () => {
    render(
      <MyStoriesView
        stories={[
          makeStory({ lifecycle_status: "pending_review" }),
          makeStory({
            id: "44444444-4444-4444-8444-444444444444",
            title: "Awaiting my approval",
            lifecycle_status: "awaiting_contributor_approval",
          }),
        ]}
      />,
    );

    expect(
      screen.queryByRole("link", { name: /^Edit/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Review/ })).toBeInTheDocument();
  });

  it("offers Delete only for a never-published draft, with a confirm step", async () => {
    const { deleteDraftStoryAction } = await import("./actions");
    const user = userEvent.setup();
    render(
      <MyStoriesView
        stories={[
          makeStory(),
          makeStory({
            id: "44444444-4444-4444-8444-444444444444",
            title: "Already published",
            lifecycle_status: "published",
            published_revision_id: "55555555-5555-4555-8555-555555555555",
          }),
        ]}
      />,
    );

    // Only the plain draft is deletable -- exactly one trash-icon trigger.
    expect(screen.getAllByRole("button", { name: /^Delete/ })).toHaveLength(1);

    const deleteButton = screen.getByRole("button", {
      name: "Delete Picking apples in Hawke's Bay",
    });
    await user.click(deleteButton);

    expect(
      screen.getByRole("heading", { name: "Delete this story?" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.queryByRole("heading", { name: "Delete this story?" }),
    ).not.toBeInTheDocument();

    await user.click(deleteButton);
    await user.click(screen.getByRole("button", { name: "Delete story" }));

    expect(deleteDraftStoryAction).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      1,
    );
  });

  describe("location filtering", () => {
    const otago = makeStory({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      title: "A season in Otago",
      regions: [{ region_name: "Otago", destination_name: "Queenstown" }],
    });
    const nelson = makeStory({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
      title: "Nelson apples",
      regions: [{ region_name: "Nelson", destination_name: "Motueka" }],
    });

    it("shows a Region chip row only when the stories span more than one region, and narrows the list", async () => {
      const user = userEvent.setup();
      render(<MyStoriesView stories={[otago, nelson]} />);

      const regionGroup = screen.getByRole("group", {
        name: "Filter stories by region",
      });
      expect(
        within(regionGroup).getByRole("button", { name: "Nelson" }),
      ).toBeInTheDocument();
      // Both stories visible before filtering.
      expect(
        screen.getByRole("link", { name: "A season in Otago" }),
      ).toBeInTheDocument();

      await user.click(
        within(regionGroup).getByRole("button", { name: "Otago" }),
      );

      expect(
        screen.getByRole("link", { name: "A season in Otago" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("link", { name: "Nelson apples" }),
      ).not.toBeInTheDocument();
    });

    it("filters on the Destination axis", async () => {
      const user = userEvent.setup();
      render(<MyStoriesView stories={[otago, nelson]} />);

      const destinationGroup = screen.getByRole("group", {
        name: "Filter stories by destination",
      });
      await user.click(
        within(destinationGroup).getByRole("button", { name: "Motueka" }),
      );

      expect(
        screen.queryByRole("link", { name: "A season in Otago" }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "Nelson apples" }),
      ).toBeInTheDocument();
    });

    it("renders no chip rows when every story shares one region", () => {
      render(
        <MyStoriesView
          stories={[
            otago,
            makeStory({
              id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
              title: "Another Otago story",
              regions: [
                { region_name: "Otago", destination_name: "Queenstown" },
              ],
            }),
          ]}
        />,
      );

      expect(
        screen.queryByRole("group", { name: /^Filter stories by/ }),
      ).not.toBeInTheDocument();
    });

    it("clears an active filter", async () => {
      const user = userEvent.setup();
      render(<MyStoriesView stories={[otago, nelson]} />);

      const regionGroup = screen.getByRole("group", {
        name: "Filter stories by region",
      });
      await user.click(
        within(regionGroup).getByRole("button", { name: "Otago" }),
      );
      expect(
        screen.queryByRole("link", { name: "Nelson apples" }),
      ).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "CLEAR" }));
      expect(
        screen.getByRole("link", { name: "Nelson apples" }),
      ).toBeInTheDocument();
    });

    it("shows a distinct empty message when a filter matches nothing", async () => {
      const user = userEvent.setup();
      render(<MyStoriesView stories={[otago, nelson]} />);

      const regionGroup = screen.getByRole("group", {
        name: "Filter stories by region",
      });
      const destinationGroup = screen.getByRole("group", {
        name: "Filter stories by destination",
      });
      await user.click(
        within(regionGroup).getByRole("button", { name: "Otago" }),
      );
      await user.click(
        within(destinationGroup).getByRole("button", { name: "Motueka" }),
      );

      expect(
        screen.getByText(/No stories match those filters/i),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(/haven't started a story yet/i),
      ).not.toBeInTheDocument();
    });
  });
});
