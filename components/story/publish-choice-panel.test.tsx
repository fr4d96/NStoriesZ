import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PublishChoicePanel } from "./publish-choice-panel";
import type { StoryRequirement } from "@/lib/story/steps";

// Both branches' Server Actions transitively import lib/story/mutations.ts,
// which is marked "server-only" and so cannot be pulled into a jsdom test --
// same reason and same treatment as my-stories-view.test.tsx's stubs. Only
// this component's own rendering and choice behaviour is under test here;
// what the actions do is covered by the RPCs' own integration tests
// (tests/integration/story-rls.integration.test.ts).
vi.mock("@/app/(contributor)/stories/[id]/preview/actions", () => ({
  submitOwnConsentAction: vi.fn(async () => ({})),
  keepStoryPrivateAction: vi.fn(async () => ({})),
}));

const baseProps = {
  storyId: "11111111-1111-4111-8111-111111111111",
  revisionId: "22222222-2222-4222-8222-222222222222",
  expectedVersion: 3,
  hasMedia: true,
  isEditorialImport: false,
  submitLabel: "Submit for review",
  allowPrivate: true,
  isAlreadyPrivate: false,
  missingForPublic: [] as StoryRequirement[],
  missingForPrivate: [] as StoryRequirement[],
  canEdit: true,
};

function renderPanel(overrides: Partial<typeof baseProps> = {}) {
  return render(<PublishChoicePanel {...baseProps} {...overrides} />);
}

describe("PublishChoicePanel", () => {
  it("opens on the public branch, with its consent questions", () => {
    renderPanel();
    expect(screen.getByRole("radio", { name: /Everyone/ })).toBeChecked();
    expect(
      screen.getByRole("button", { name: "Submit for review" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /right to publish this story/i }),
    ).toBeInTheDocument();
  });

  it("asks no consent questions at all on the private branch", async () => {
    // The heart of the feature. Every one of these fields records
    // permission to put this story -- and someone else's face -- in front
    // of the public (docs/content-governance.md). A private story publishes
    // nothing, so asking would either collect a permission that was never
    // needed or, worse, file one against a story the contributor
    // deliberately chose not to publish.
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("radio", { name: /Just me/ }));

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: /identifiable people/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Submit for review" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save as private" }),
    ).toBeInTheDocument();
  });

  it("tells the contributor no moderator is involved", async () => {
    // They have just come through a step whose every other outcome sends
    // the story to a moderator. Leaving that unsaid invites them to wait
    // for a review that is never coming.
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("radio", { name: /Just me/ }));
    expect(screen.getByText(/No moderator reads it/i)).toBeInTheDocument();
  });

  it("hides the choice entirely when private is not allowed", () => {
    // An editorial import, or an already-published story: both are refusals
    // keep_revision_private() makes server-side, so the choice must not be
    // offered here either.
    renderPanel({ allowPrivate: false });
    expect(
      screen.queryByRole("radio", { name: /Just me/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Submit for review" }),
    ).toBeInTheDocument();
  });

  it("opens on the private branch for a story that is already private", () => {
    // Re-saving is the default for a story already in that state; going
    // public stays the deliberate act.
    renderPanel({ isAlreadyPrivate: true });
    expect(screen.getByRole("radio", { name: /Just me/ })).toBeChecked();
    expect(
      screen.getByRole("button", { name: "Save changes" }),
    ).toBeInTheDocument();
  });

  it("drops the location and tag requirements when the destination changes", async () => {
    // Both lists are computed server-side and handed in; switching between
    // them must actually change what the notice demands, or a contributor
    // who chose "Just me" would still be blocked on public-only fields.
    const user = userEvent.setup();
    renderPanel({
      missingForPublic: [
        { label: "at least one location", step: "places" },
        { label: "at least one tag", step: "places" },
      ],
      missingForPrivate: [],
    });

    const notice = screen.getByRole("status");
    expect(within(notice).getByText(/at least one location/)).toBeVisible();

    await user.click(screen.getByRole("radio", { name: /Just me/ }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save as private" }),
    ).toBeInTheDocument();
  });

  it("still blocks a private story that has no title or content", async () => {
    const user = userEvent.setup();
    renderPanel({
      missingForPublic: [{ label: "your story", step: "story" }],
      missingForPrivate: [{ label: "your story", step: "story" }],
    });
    await user.click(screen.getByRole("radio", { name: /Just me/ }));

    expect(screen.getByRole("status")).toHaveTextContent(/your story/);
    expect(
      screen.queryByRole("button", { name: "Save as private" }),
    ).not.toBeInTheDocument();
  });

  it("groups the two options for assistive technology", () => {
    // A <fieldset>/<legend> pair, so a screen reader announces what the two
    // radios are a choice between rather than reading them as two loose
    // controls (Engineering Rule 19).
    renderPanel();
    expect(
      screen.getByRole("group", { name: /Who is this story for/i }),
    ).toBeInTheDocument();
  });
});
