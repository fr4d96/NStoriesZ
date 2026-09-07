import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MyStoriesView } from "./my-stories-view";
import { ToastProvider } from "@/components/ui/toast";
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
  requestStoryTakedownAction: vi.fn(async () => ({ ok: true }) as const),
  cancelStoryTakedownAction: vi.fn(async () => ({ ok: true }) as const),
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: (href: string) => push(href) }),
}));

// StartRevisionButton calls into the story lifecycle actions, which import
// "server-only" modules -- stubbed for the same reason as ./actions above.
vi.mock("@/app/(contributor)/stories/[id]/preview/actions", () => ({
  startStoryRevisionAction: vi.fn(
    async () =>
      ({
        ok: true,
        revisionId: "66666666-6666-4666-8666-666666666666",
      }) as const,
  ),
}));

// list_my_stories()'s generated row type declares the revision-pointer
// columns non-null (Supabase's generator can't read nullability through a
// RETURNS TABLE), but they really are null for a story with nothing in
// flight -- which is precisely the state several of these tests set up.
type StoryOverrides = Partial<
  Omit<MyStoryWithCover, "current_draft_revision_id" | "published_revision_id">
> & {
  current_draft_revision_id?: string | null;
  published_revision_id?: string | null;
};

function makeStory(overrides: StoryOverrides = {}) {
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
    draftRevisionStatus: "draft",
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
  push.mockClear();
  // jsdom implements no layout, so Element.prototype.scrollIntoView does not
  // exist -- goToPage() calls it when the page changes.
  Element.prototype.scrollIntoView = vi.fn();
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

  describe("taking a published story down", () => {
    const published = makeStory({
      id: "44444444-4444-4444-8444-444444444444",
      title: "Already published",
      lifecycle_status: "published",
      published_revision_id: "55555555-5555-4555-8555-555555555555",
      current_draft_revision_id: null,
      draftRevisionStatus: null,
      version: 7,
    });

    it("offers Take down only on a published story, never on a draft", () => {
      render(<MyStoriesView stories={[makeStory(), published]} />);

      const takeDowns = screen.getAllByRole("button", {
        name: /^Take down/,
      });
      expect(takeDowns).toHaveLength(1);
      expect(takeDowns[0]).toHaveAccessibleName("Take down Already published");

      // ...and the two destructive actions are never offered on the same
      // story: Delete belongs to the never-published draft, Take down to the
      // published one.
      expect(
        screen.getByRole("button", { name: /^Delete/ }),
      ).toHaveAccessibleName("Delete Picking apples in Hawke's Bay");
    });

    it("says what a takedown actually does before doing it, and can be backed out of", async () => {
      const { requestStoryTakedownAction } = await import("./actions");
      vi.mocked(requestStoryTakedownAction).mockClear();
      const user = userEvent.setup();
      render(<MyStoriesView stories={[published]} />);

      await user.click(
        screen.getByRole("button", { name: "Take down Already published" }),
      );

      expect(requestStoryTakedownAction).not.toHaveBeenCalled();
      expect(
        screen.getByRole("heading", {
          name: "Ask for this story to be taken down?",
        }),
      ).toBeInTheDocument();
      // The two things a contributor cannot work out from the button, and
      // the first one matters most: asking does NOT take the story down.
      // Someone who has just asked will otherwise assume it is already gone.
      expect(
        screen.getByText(/stays public until they do/i),
      ).toBeInTheDocument();
      expect(screen.getByText(/Nothing is deleted/i)).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(
        screen.queryByRole("heading", {
          name: "Ask for this story to be taken down?",
        }),
      ).not.toBeInTheDocument();
      expect(requestStoryTakedownAction).not.toHaveBeenCalled();
    });

    it("passes the story's own version through as the concurrency token", async () => {
      const { requestStoryTakedownAction } = await import("./actions");
      vi.mocked(requestStoryTakedownAction).mockClear();
      const user = userEvent.setup();
      render(<MyStoriesView stories={[published]} />);

      await user.click(
        screen.getByRole("button", { name: "Take down Already published" }),
      );
      await user.click(
        screen.getByRole("button", { name: "Ask for takedown" }),
      );

      await waitFor(() =>
        expect(requestStoryTakedownAction).toHaveBeenCalledWith(
          "44444444-4444-4444-8444-444444444444",
          7,
        ),
      );
    });

    it("shows the reason a takedown was refused instead of failing silently", async () => {
      const { requestStoryTakedownAction } = await import("./actions");
      vi.mocked(requestStoryTakedownAction).mockResolvedValueOnce({
        ok: false,
        error: "This story has already been taken down.",
      });
      const user = userEvent.setup();
      render(
        <ToastProvider>
          <MyStoriesView stories={[published]} />
        </ToastProvider>,
      );

      await user.click(
        screen.getByRole("button", { name: "Take down Already published" }),
      );
      await user.click(
        screen.getByRole("button", { name: "Ask for takedown" }),
      );

      expect(
        await screen.findByText("This story has already been taken down."),
      ).toBeInTheDocument();
      // The dialog closes rather than sitting there looking busy forever.
      expect(
        screen.queryByRole("heading", {
          name: "Ask for this story to be taken down?",
        }),
      ).not.toBeInTheDocument();
    });
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

  it("offers Edit on a published story with nothing in flight, and asks before starting one", async () => {
    const { startStoryRevisionAction } =
      await import("@/app/(contributor)/stories/[id]/preview/actions");
    const user = userEvent.setup();
    render(
      <MyStoriesView
        stories={[
          makeStory({
            lifecycle_status: "published",
            published_revision_id: "55555555-5555-4555-8555-555555555555",
            current_draft_revision_id: null,
            draftRevisionStatus: null,
          }),
        ]}
      />,
    );

    await user.click(
      screen.getByRole("button", {
        name: "Edit Picking apples in Hawke's Bay",
      }),
    );

    // Nothing has been created yet -- the contributor is asked first, and
    // told the live story stays live.
    expect(startStoryRevisionAction).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { name: "Make changes to this story?" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/stays up, unchanged/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Yes, edit it" }));

    await waitFor(() =>
      expect(startStoryRevisionAction).toHaveBeenCalledWith(
        "11111111-1111-4111-8111-111111111111",
      ),
    );
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        "/stories/11111111-1111-4111-8111-111111111111/edit",
      ),
    );
  });

  it("backs out of starting a revision when the contributor says no", async () => {
    const { startStoryRevisionAction } =
      await import("@/app/(contributor)/stories/[id]/preview/actions");
    vi.mocked(startStoryRevisionAction).mockClear();
    const user = userEvent.setup();
    render(
      <MyStoriesView
        stories={[
          makeStory({
            lifecycle_status: "published",
            published_revision_id: "55555555-5555-4555-8555-555555555555",
            current_draft_revision_id: null,
            draftRevisionStatus: null,
          }),
        ]}
      />,
    );

    await user.click(
      screen.getByRole("button", {
        name: "Edit Picking apples in Hawke's Bay",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(
      screen.queryByRole("heading", { name: "Make changes to this story?" }),
    ).not.toBeInTheDocument();
    expect(startStoryRevisionAction).not.toHaveBeenCalled();
  });

  it("hides Edit while a published story's update is with a moderator, and says so", () => {
    render(
      <MyStoriesView
        stories={[
          makeStory({
            lifecycle_status: "published",
            published_revision_id: "55555555-5555-4555-8555-555555555555",
            draftRevisionStatus: "submitted",
          }),
        ]}
      />,
    );

    // lifecycle_status is still "published" -- that is what keeps the live
    // version live -- so the submitted revision is the only signal there is.
    // Scoped to the row: "Published" now names the collapsible section too,
    // so an unscoped getByText matches twice.
    const row = screen.getByRole("listitem");
    expect(within(row).getByText("Published")).toBeInTheDocument();
    expect(screen.getByText("Update in review")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /^Edit/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Edit/ }),
    ).not.toBeInTheDocument();
  });

  it("keeps Edit available on a published story's unsubmitted update", () => {
    render(
      <MyStoriesView
        stories={[
          makeStory({
            lifecycle_status: "published",
            published_revision_id: "55555555-5555-4555-8555-555555555555",
            draftRevisionStatus: "draft",
          }),
        ]}
      />,
    );

    expect(screen.getByText("Update in progress")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Edit Picking apples in Hawke's Bay" }),
    ).toHaveAttribute(
      "href",
      "/stories/11111111-1111-4111-8111-111111111111/edit",
    );
  });

  // Stories are grouped into collapsible sections by status. The pager that
  // used to live here went with the change: paging across groups is
  // incoherent, and collapsing a group is the better length control.
  function sectioned() {
    return [
      makeStory({
        id: "00000000-0000-4000-8000-000000000001",
        title: "A draft",
        lifecycle_status: "draft",
      }),
      makeStory({
        id: "00000000-0000-4000-8000-000000000002",
        title: "Sent back",
        lifecycle_status: "changes_requested",
      }),
      makeStory({
        id: "00000000-0000-4000-8000-000000000003",
        title: "With a moderator",
        lifecycle_status: "pending_review",
        draftRevisionStatus: "submitted",
      }),
      makeStory({
        id: "00000000-0000-4000-8000-000000000004",
        title: "Live one",
        lifecycle_status: "published",
        current_draft_revision_id: null,
        published_revision_id: "44444444-4444-4444-8444-444444444444",
      }),
    ] as MyStoryWithCover[];
  }

  function section(name: string) {
    return screen.getByRole("group", { name: new RegExp(name) });
  }

  it("groups stories into Drafts, In review and Published, each with a count", () => {
    render(<MyStoriesView stories={sectioned()} />);

    expect(within(section("Drafts")).getByText("A draft")).toBeInTheDocument();
    expect(
      within(section("Drafts")).getByText("Sent back"),
    ).toBeInTheDocument();
    expect(
      within(section("In review")).getByText("With a moderator"),
    ).toBeInTheDocument();
    expect(
      within(section("Published")).getByText("Live one"),
    ).toBeInTheDocument();

    // The count beside each label, so a collapsed section still says how much
    // is inside it.
    expect(within(section("Drafts")).getByText("2")).toBeInTheDocument();
    expect(within(section("Published")).getByText("1")).toBeInTheDocument();
  });

  it("gives a private story its own section, not the Not published one", () => {
    // A private story's lifecycle_status is neither published, nor a review
    // state, nor draft/changes_requested, so before it was handled
    // explicitly it fell through to `closed` and appeared under
    // "Not published — archived or not approved". That reads as something
    // having gone wrong, when it is exactly what the contributor asked for.
    render(
      <MyStoriesView
        stories={
          [
            ...sectioned(),
            makeStory({
              id: "00000000-0000-4000-8000-000000000005",
              title: "Just for me",
              // Cast for the same reason lib/story/story-visibility.ts takes
              // a plain `string`: types/database.ts is generated from a live
              // Supabase project and has not been regenerated since
              // 20260907100000 added 'private' to story_lifecycle_status, so
              // the union here is one value short of the real enum. Drops
              // out the moment `npm run supabase:types:linked` is run.
              lifecycle_status:
                "private" as MyStoryWithCover["lifecycle_status"],
              published_revision_id: null,
            }),
          ] as MyStoryWithCover[]
        }
      />,
    );

    expect(
      within(section("Private")).getByText("Just for me"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: /Not published/ }),
    ).not.toBeInTheDocument();
  });

  it("does not render a section with nothing in it", () => {
    render(<MyStoriesView stories={sectioned()} />);
    // Nothing here is rejected or archived, so the contributor is never told
    // about a "Not published" group they have never had.
    expect(
      screen.queryByRole("group", { name: /Not published/ }),
    ).not.toBeInTheDocument();
  });

  it("lands with Drafts collapsed and everything else open", () => {
    render(<MyStoriesView stories={sectioned()} />);

    // Drafts is the pile that only ever grows, so it starts folded to keep
    // Published above the fold. Folded, not hidden: the count is still there.
    expect(section("Drafts")).not.toHaveAttribute("open");
    expect(within(section("Drafts")).getByText("2")).toBeInTheDocument();

    expect(section("In review")).toHaveAttribute("open");
    expect(section("Published")).toHaveAttribute("open");
  });

  it("opens Drafts when you click it, without touching the other sections", async () => {
    const user = userEvent.setup();
    render(<MyStoriesView stories={sectioned()} />);

    await user.click(screen.getByText("Drafts"));

    // <details> keeps its content in the DOM; what changes is the open state,
    // which is what a screen reader announces and what hides the rows.
    expect(section("Drafts")).toHaveAttribute("open");
    expect(section("Published")).toHaveAttribute("open");
    expect(screen.getByText("Live one")).toBeVisible();

    // And closing it again leaves its neighbours alone.
    await user.click(screen.getByText("Drafts"));
    expect(section("Drafts")).not.toHaveAttribute("open");
    expect(section("Published")).toHaveAttribute("open");
  });

  it("keeps a published story with an update in review under Published", () => {
    // Engineering Rule 11: the live version stays live for the whole review,
    // so the story belongs where readers can still find it. The in-flight
    // edit shows as a chip on the row instead.
    render(
      <MyStoriesView
        stories={
          [
            makeStory({
              lifecycle_status: "published",
              published_revision_id: "44444444-4444-4444-8444-444444444444",
              current_draft_revision_id: "55555555-5555-4555-8555-555555555555",
              draftRevisionStatus: "submitted",
            }),
          ] as MyStoryWithCover[]
        }
      />,
    );

    expect(
      within(section("Published")).getByText("Picking apples in Hawke's Bay"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: /In review/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Update in review")).toBeInTheDocument();
  });

  it("numbers rows within a section rather than across the whole list", () => {
    render(<MyStoriesView stories={sectioned()} />);
    // Drafts holds two rows and Published one, so a per-section ordinal means
    // "01" appears in more than one place -- a continuous run would not.
    expect(screen.getAllByText("01").length).toBeGreaterThan(1);
  });
});
