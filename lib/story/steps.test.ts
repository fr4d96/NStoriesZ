import { describe, expect, it } from "vitest";
import {
  missingStoryRequirements,
  REQUIRED_STORY_STEPS,
  EDITING_STORY_STEPS,
  STORY_STEPS,
} from "./steps";

const complete = {
  title: "A season on the vines",
  hasContent: true,
  locationCount: 1,
  tagCount: 1,
};

describe("missingStoryRequirements", () => {
  it("returns nothing for a story that is ready", () => {
    expect(missingStoryRequirements(complete)).toEqual([]);
  });

  it("names a missing title and points at the Title step", () => {
    expect(missingStoryRequirements({ ...complete, title: "" })).toEqual([
      { label: "a title", step: "title" },
    ]);
  });

  // A title of nothing but spaces is not a title -- the server's own
  // createDraftSchema/revisionInputSchema trim before checking, so the UI
  // gate has to agree or it would wave through something the save rejects.
  it("treats a whitespace-only title as missing", () => {
    expect(missingStoryRequirements({ ...complete, title: "   " })).toEqual([
      { label: "a title", step: "title" },
    ]);
  });

  it("names missing content and points at the Your story step", () => {
    expect(
      missingStoryRequirements({ ...complete, hasContent: false }),
    ).toEqual([{ label: "your story", step: "story" }]);
  });

  // Locations and tags are separate requirements even though they share a
  // step: "finish Places & tags" does not tell a contributor which of the
  // two they actually left empty.
  it("distinguishes a missing location from a missing tag", () => {
    expect(missingStoryRequirements({ ...complete, locationCount: 0 })).toEqual(
      [{ label: "at least one location", step: "places" }],
    );
    expect(missingStoryRequirements({ ...complete, tagCount: 0 })).toEqual([
      { label: "at least one tag", step: "places" },
    ]);
  });

  it("lists every unmet requirement, in step order", () => {
    const missing = missingStoryRequirements({
      title: "",
      hasContent: false,
      locationCount: 0,
      tagCount: 0,
    });
    expect(missing.map((m) => m.label)).toEqual([
      "a title",
      "your story",
      "at least one location",
      "at least one tag",
    ]);
    // The preview page links its notice at missing[0].step, so the order
    // has to match the order the labels are read out in.
    expect(missing[0].step).toBe("title");
  });

  it("only ever points at steps that exist and are editable", () => {
    const missing = missingStoryRequirements({
      title: "",
      hasContent: false,
      locationCount: 0,
      tagCount: 0,
    });
    // Set<string>, not Set<StoryStepId>: EDITING_STORY_STEPS is narrowed
    // enough that TypeScript already knows "review" is not in it and
    // rejects the comparison outright. The runtime assertion still earns
    // its place -- it is the list, not the type, that a future edit would
    // get wrong.
    const editable = new Set<string>(EDITING_STORY_STEPS.map((s) => s.id));
    for (const requirement of missing) {
      expect(editable.has(requirement.step)).toBe(true);
    }
  });
});

describe("step definitions", () => {
  it("marks every required step as one the editor can open", () => {
    const editable = new Set<string>(EDITING_STORY_STEPS.map((s) => s.id));
    for (const id of REQUIRED_STORY_STEPS) {
      expect(editable.has(id)).toBe(true);
    }
  });

  it("keeps review as the one step that is not an editor pane", () => {
    expect(STORY_STEPS.length - EDITING_STORY_STEPS.length).toBe(1);
    expect(EDITING_STORY_STEPS.map((s) => s.id as string)).not.toContain(
      "review",
    );
    expect(STORY_STEPS[STORY_STEPS.length - 1].id).toBe("review");
  });
});
