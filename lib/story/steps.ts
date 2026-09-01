/**
 * The one definition of the new-story timeline, shared by the editor
 * (components/story/story-edit-form.tsx, which owns steps 1-5 as in-page
 * state) and by the preview page (app/(contributor)/stories/[id]/preview,
 * which IS step 6). Keeping the list here is what lets both surfaces show
 * the same progress bar with the same numbering -- the contributor sees one
 * continuous flow even though it spans two routes.
 *
 * This file holds ONLY plain data, deliberately kept out of the
 * "use client" component that renders it (components/story/story-steps.tsx).
 * A Server Component importing a value from a "use client" module does not
 * receive the value -- it receives a client reference proxy, so
 * `STORY_STEPS.find(...)` throws "is not a function" at request time. Both
 * the edit page and the preview page are Server Components and both need
 * the real array, so the data lives in a module with no directive at all
 * and each side imports it directly.
 *
 * Why the last step is a route and not another pane: submission is
 * authorized server-side on the preview page (see its `canSubmitOwnConsent`
 * and `missingRequirements` derivation, both computed from a fresh
 * getStoryPreview() call). Re-deriving that inside a client form would mean
 * duplicating an authorization decision, which Engineering Rule 2 rules
 * out. So "Next" on the last editing step navigates there instead.
 */
export const STORY_STEPS = [
  { id: "title", label: "Title", hint: "What it's called" },
  { id: "story", label: "Your story", hint: "The writing itself" },
  { id: "photos", label: "Photos", hint: "Optional" },
  { id: "trip", label: "Trip", hint: "Optional" },
  { id: "places", label: "Places & tags", hint: "Where and what" },
  { id: "review", label: "Review & submit", hint: "Check it, then send" },
] as const;

export type StoryStepId = (typeof STORY_STEPS)[number]["id"];

/** The steps the preview page's `missingRequirements` gate can complain about. */
export const REQUIRED_STORY_STEPS: readonly StoryStepId[] = [
  "title",
  "story",
  "places",
];

/** Every step that is a pane of the editor -- i.e. all but the preview route. */
export const EDITING_STORY_STEPS = STORY_STEPS.filter(
  (step) => step.id !== "review",
);

export type StoryRequirement = {
  /** Reads as a list item after "Add …": "a title", "at least one tag". */
  label: string;
  /** Which step the contributor has to go to in order to supply it. */
  step: StoryStepId;
};

/**
 * The one definition of "what a story still needs before it can be
 * submitted", shared by the editor (which gates its "Review & submit"
 * button on it) and the preview page (which gates the submit panel itself).
 *
 * Shared deliberately. These two lists were written twice and were already
 * drifting -- the editor tracked "places" as a single done/not-done flag
 * while the preview page distinguished a missing location from a missing
 * tag, so the editor could tell you a step was incomplete without being
 * able to say which half. One function means the editor's message and the
 * submit gate's message are the same sentence about the same rule.
 *
 * NOT an authorization decision: the preview page recomputes this from a
 * fresh server read, and `submit_revision_with_consent()` remains the
 * non-bypassable check (Engineering Rules 2 and 3). This is what the UI
 * says, not what the database enforces.
 */
export function missingStoryRequirements(input: {
  title: string;
  hasContent: boolean;
  locationCount: number;
  tagCount: number;
}): StoryRequirement[] {
  const missing: StoryRequirement[] = [];
  if (!input.title.trim()) missing.push({ label: "a title", step: "title" });
  if (!input.hasContent) missing.push({ label: "your story", step: "story" });
  if (input.locationCount < 1) {
    missing.push({ label: "at least one location", step: "places" });
  }
  if (input.tagCount < 1) {
    missing.push({ label: "at least one tag", step: "places" });
  }
  return missing;
}
