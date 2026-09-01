import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StoryStepProgress } from "./story-steps";
import { STORY_STEPS } from "@/lib/story/steps";

describe("StoryStepProgress", () => {
  it("names the current step and its position in the timeline", () => {
    render(<StoryStepProgress currentStep="trip" doneSteps={[]} />);
    expect(screen.getByText(/Step 4 of 6/)).toBeInTheDocument();
    expect(screen.getByText(/· Trip/)).toBeInTheDocument();
  });

  it("renders one control per step", () => {
    render(<StoryStepProgress currentStep="title" doneSteps={[]} />);
    expect(screen.getAllByRole("button")).toHaveLength(STORY_STEPS.length);
  });

  // The regression this guards: an earlier version treated "current" and
  // "done" as two values of one enum, so the step you were standing on lost
  // its tick -- you only ever saw a step confirmed after leaving it.
  it("ticks the current step when it is also complete", () => {
    render(<StoryStepProgress currentStep="title" doneSteps={["title"]} />);
    expect(
      screen.getByRole("button", { name: /Step 1 of 6: Title/ }),
    ).toHaveAccessibleName(/current step, done/);
  });

  it("says which incomplete steps are still required", () => {
    render(<StoryStepProgress currentStep="title" doneSteps={[]} />);
    // Required (per the preview page's missingRequirements gate).
    expect(
      screen.getByRole("button", { name: /Places & tags/ }),
    ).toHaveAccessibleName(/still needed/);
    // Optional -- empty is a perfectly finished state.
    expect(
      screen.getByRole("button", { name: /Photos/ }),
    ).not.toHaveAccessibleName(/still needed/);
  });

  it("marks only the current step with aria-current", () => {
    render(<StoryStepProgress currentStep="photos" doneSteps={[]} />);
    const current = screen
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-current") === "step");
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAccessibleName(/Photos/);
  });

  // Never locked: every field autosaves on its own, so there is no
  // half-committed state a jump could corrupt.
  it("lets you select a step you have not reached yet", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <StoryStepProgress
        currentStep="title"
        doneSteps={[]}
        onSelect={onSelect}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Places & tags/ }));
    expect(onSelect).toHaveBeenCalledWith("places");
  });

  // "Review & submit" is a different route, reachable only from step 5's own
  // button. Before the lock, clicking its circle in the editor set an
  // in-page step with no section to render -- a blank screen.
  it("makes a locked step neither clickable nor tabbable", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <StoryStepProgress
        currentStep="title"
        doneSteps={[]}
        onSelect={onSelect}
        lockedSteps={["review"]}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /Review & submit/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Review & submit/ }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByLabelText(/Review & submit/));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("says a locked step is not available yet", () => {
    render(
      <StoryStepProgress
        currentStep="title"
        doneSteps={[]}
        lockedSteps={["review"]}
      />,
    );
    expect(screen.getByLabelText(/Review & submit/)).toHaveAccessibleName(
      /not available yet/,
    );
  });

  it("renders links instead of buttons when given hrefs", () => {
    render(
      <StoryStepProgress
        currentStep="review"
        doneSteps={["title", "story"]}
        hrefs={{ title: "/stories/abc/edit?step=title" }}
      />,
    );
    expect(
      screen.getByRole("link", { name: /Step 1 of 6: Title/ }),
    ).toHaveAttribute("href", "/stories/abc/edit?step=title");
    // A step with no href stays a button -- the caller decides per step,
    // so the review step itself is not a link back to its own page.
    expect(
      screen.getByRole("button", { name: /Review & submit/ }),
    ).toBeInTheDocument();
  });
});
