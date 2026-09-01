import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";

import { MutationQueue } from "@/lib/story/mutation-queue";
import type { RevisionMediaItem } from "@/lib/story/contributor-queries";

// Every Server Action and the browser Supabase client are stubbed: this file
// tests the panel's own rendering rules, not the upload pipeline (which is
// covered by the RLS/e2e suites against a real project).
const updateMediaCaptionAction = vi.fn(async () => ({ ok: true as const }));

vi.mock("@/app/(contributor)/stories/[id]/edit/actions", () => ({
  reorderMediaAction: vi.fn(async () => ({ ok: true })),
  setCoverAction: vi.fn(async () => ({ ok: true })),
  detachMediaAction: vi.fn(async () => ({ ok: true })),
  updateMediaCaptionAction: (...args: unknown[]) =>
    updateMediaCaptionAction(...(args as [])),
}));
vi.mock("@/app/(contributor)/stories/[id]/media-actions", () => ({
  mintPreviewUrlAction: vi.fn(async () => ({ error: "no preview in tests" })),
  refreshMediaAction: vi.fn(async () => ({ error: "no refresh in tests" })),
}));
vi.mock("@/app/(contributor)/stories/[id]/edit/upload-actions", () => ({
  beginMediaUploadAction: vi.fn(async () => ({ error: "not used" })),
  finalizeMediaUploadAction: vi.fn(async () => ({ error: "not used" })),
  transcodeHeicUploadAction: vi.fn(async () => ({ error: "not used" })),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session: null } }) },
  }),
}));

const { ImageUploadManager } = await import("./image-upload-manager");

const PLACED_ID = "11111111-1111-4111-8111-111111111111";
const UNPLACED_ID = "22222222-2222-4222-8222-222222222222";

function mediaItem(mediaId: string, sortOrder: number): RevisionMediaItem {
  return {
    mediaId,
    sortOrder,
    isCover: false,
    altText: null,
    caption: null,
    decorative: false,
    processingState: "processed",
    sha256: null,
  };
}

function renderPanel(inlineMediaIds: Set<string>) {
  const versionRef = createRef<number>() as { current: number };
  versionRef.current = 1;
  return render(
    <ImageUploadManager
      storyId="story-1"
      revisionId="revision-1"
      initialMedia={[mediaItem(PLACED_ID, 0), mediaItem(UNPLACED_ID, 1)]}
      versionRef={versionRef}
      queue={new MutationQueue()}
      onVersionBumped={() => {}}
      inlineMediaIds={inlineMediaIds}
    />,
  );
}

describe("ImageUploadManager — images already placed in the story", () => {
  it("splits placed and unplaced images into their own groups", () => {
    renderPanel(new Set([PLACED_ID]));
    expect(screen.getByText("1 image in your story")).toBeInTheDocument();
    expect(screen.getByText("1 uploaded image")).toBeInTheDocument();
  });

  it("keeps alt text and caption editable after an image is placed", async () => {
    // The gap this closes: placed images used to be filtered out of the
    // panel completely, so describing a photo after putting it where it
    // belonged was impossible.
    renderPanel(new Set([PLACED_ID]));
    const placedGroup = screen
      .getByText("1 image in your story")
      .closest("details");
    expect(placedGroup).not.toBeNull();
    const group = within(placedGroup as HTMLElement);

    const altText = group.getByLabelText(/^Alt text/);
    await userEvent.type(altText, "A vineyard at dawn");
    expect(altText).toHaveValue("A vineyard at dawn");
    expect(updateMediaCaptionAction).toHaveBeenCalled();

    expect(group.getByLabelText(/^Caption/)).toBeInTheDocument();
  });

  it("does not offer 'Add to story' or reordering for an image already in the text", () => {
    renderPanel(new Set([PLACED_ID]));
    const placedGroup = within(
      screen
        .getByText("1 image in your story")
        .closest("details") as HTMLElement,
    );
    expect(
      placedGroup.queryByRole("button", { name: "Add to story" }),
    ).not.toBeInTheDocument();
    expect(
      placedGroup.queryByRole("button", { name: "Move up" }),
    ).not.toBeInTheDocument();
    expect(
      placedGroup.getByRole("button", { name: "Remove from story" }),
    ).toBeInTheDocument();
  });

  it("shows no placed group at all when nothing has been placed yet", () => {
    renderPanel(new Set());
    expect(
      screen.queryByText(/image[s]? in your story/),
    ).not.toBeInTheDocument();
    expect(screen.getByText("2 uploaded images")).toBeInTheDocument();
  });
});
