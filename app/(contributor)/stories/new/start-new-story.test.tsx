import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StartNewStory } from "./start-new-story";
import { createDraftAction } from "./actions";

// createDraftAction transitively imports lib/story/mutations.ts, which is
// marked "server-only" and cannot be loaded in jsdom -- stubbed, so what is
// under test here is purely the gate this component puts in front of it.
vi.mock("./actions", () => ({
  createDraftAction: vi.fn(async () => ({})),
}));

const createDraftActionMock = vi.mocked(createDraftAction);

describe("StartNewStory", () => {
  beforeEach(() => {
    createDraftActionMock.mockClear();
  });

  // The regression this component exists to prevent: the previous version
  // fired createDraftAction() from a mount effect, so merely landing on
  // /stories/new wrote an "Untitled story" row.
  it("creates nothing on mount", () => {
    render(<StartNewStory />);
    expect(createDraftActionMock).not.toHaveBeenCalled();
  });

  it("keeps the submit button disabled until a title is typed", async () => {
    const user = userEvent.setup();
    render(<StartNewStory />);

    const submit = screen.getByRole("button", { name: "Start writing" });
    expect(submit).toBeDisabled();

    // Whitespace is not a title -- the button stays disabled, mirroring
    // createDraftSchema's own `.trim().min(1)` on the server.
    await user.type(screen.getByLabelText(/^Title/), "   ");
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText(/^Title/), "Kiwifruit season");
    expect(submit).toBeEnabled();
  });

  it("submits the typed title to createDraftAction", async () => {
    const user = userEvent.setup();
    render(<StartNewStory />);

    await user.type(screen.getByLabelText(/^Title/), "Kiwifruit season");
    await user.click(screen.getByRole("button", { name: "Start writing" }));

    await waitFor(() => expect(createDraftActionMock).toHaveBeenCalledTimes(1));
    const formData = createDraftActionMock.mock.calls[0][1];
    expect(formData.get("title")).toBe("Kiwifruit season");
  });

  it("shows the error the action returns", async () => {
    createDraftActionMock.mockResolvedValueOnce({
      error: "Set up your contributor identity on the Account page first.",
    });
    const user = userEvent.setup();
    render(<StartNewStory />);

    await user.type(screen.getByLabelText(/^Title/), "Kiwifruit season");
    await user.click(screen.getByRole("button", { name: "Start writing" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Set up your contributor identity",
    );
  });
});
