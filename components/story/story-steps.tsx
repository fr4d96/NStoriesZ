"use client";

import Link from "next/link";
import {
  STORY_STEPS,
  REQUIRED_STORY_STEPS,
  type StoryStepId,
} from "@/lib/story/steps";

// Deliberately NOT re-exported from here. A Server Component importing a
// value through a "use client" module gets a client reference proxy rather
// than the value, so a convenience re-export would just reintroduce the
// "STORY_STEPS.find is not a function" bug one import hop further away.
// Server Components import the data straight from "@/lib/story/steps".

/**
 * Rail-only wording. Deliberately NOT in lib/story/steps.ts: this is a
 * layout concession, not story data -- the headings, the summary line and
 * every accessible name below still say the full `step.label`. Two entries
 * differ from it ("Places & tags" -> "Places", "Review & submit" ->
 * "Review"), and those two words are what bought the room to label all
 * seven steps at once; the rest are the same string.
 *
 * Typed as a total Record so adding a step to STORY_STEPS fails the build
 * here instead of silently rendering an unlabelled circle.
 */
const RAIL_LABELS: Record<StoryStepId, string> = {
  title: "Title",
  story: "Your story",
  photos: "Photos",
  trip: "Trip",
  expenses: "Expenses",
  places: "Places",
  review: "Review",
};

export type StoryStepProgressProps = {
  currentStep: StoryStepId;
  /** Steps whose content is filled in. Drives the tick marks. */
  doneSteps: readonly StoryStepId[];
  /**
   * Per-step navigation. `onSelect` (in-page step switching) is for client
   * callers; `hrefs` (real navigation) is for the preview page, which is a
   * Server Component and so cannot hand a function across the boundary --
   * a plain object of strings serializes, a callback does not. Pass one.
   */
  onSelect?: (step: StoryStepId) => void;
  hrefs?: Partial<Record<StoryStepId, string>>;
  /**
   * Steps the bar shows but refuses to navigate to -- rendered as an inert
   * circle rather than a control, so it is neither clickable nor tabbable
   * and a screen reader is told why.
   *
   * The editor uses this for "Review & submit": that step is a different
   * ROUTE, and the only way in is step 5's own "Review & submit →" button.
   * Without the lock, clicking the 6th circle in the editor set an in-page
   * step that has no section to render -- a blank screen, which is the bug
   * this prop exists to close.
   */
  lockedSteps?: readonly StoryStepId[];
};

/**
 * Deliberately never LOCKS a later step. Every field autosaves on its own
 * as it changes, so there is no half-committed state a jump could corrupt,
 * and a contributor who wants to fix their title on step 5 should not have
 * to walk back through four screens to do it. The tick marks report
 * progress; they do not gate it. The real gate is still the preview page's
 * server-side `missingRequirements` check, which is the only thing that
 * decides whether the submit panel renders at all.
 */
export function StoryStepProgress({
  currentStep,
  doneSteps,
  onSelect,
  hrefs,
  lockedSteps,
}: StoryStepProgressProps) {
  const currentIndex = STORY_STEPS.findIndex((s) => s.id === currentStep);
  const done = new Set(doneSteps);
  const locked = new Set(lockedSteps);

  // "current" and "done" are independent, not two values of one enum: the
  // step you are standing on still needs to tell you whether what you just
  // typed counts. Collapsing them (current wins, so the tick disappears the
  // moment you are on that step) means you only ever see a step tick after
  // you have already left it -- exactly when the feedback is useless.
  function stateOf(id: StoryStepId, index: number) {
    return {
      isCurrent: id === currentStep,
      isDone: done.has(id),
      isPast: index < currentIndex,
    };
  }

  function labelFor(id: StoryStepId, index: number) {
    const step = STORY_STEPS[index];
    const { isCurrent, isDone } = stateOf(id, index);
    const parts = [
      isCurrent && "current step",
      isDone
        ? "done"
        : REQUIRED_STORY_STEPS.includes(id)
          ? "still needed"
          : null,
      locked.has(id) && "not available yet",
    ].filter(Boolean);
    const suffix = parts.length ? ` (${parts.join(", ")})` : "";
    return `Step ${index + 1} of ${STORY_STEPS.length}: ${step.label}${suffix}`;
  }

  // A shared inner face so the <button> and <Link> branches below can never
  // drift apart visually.
  function Face({ id, index }: { id: StoryStepId; index: number }) {
    const { isCurrent, isDone } = stateOf(id, index);
    return (
      <>
        <span
          aria-hidden="true"
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors ${
            isCurrent
              ? "border-accent bg-accent text-accent-foreground"
              : isDone
                ? "border-accent/60 bg-accent/15 text-accent"
                : "border-border-subtle text-muted-foreground"
          }`}
        >
          {isDone ? "✓" : index + 1}
        </span>
        {/* Three tiers, by how much room the rail actually has:
              < sm   no labels -- the summary line above is the label.
              sm-lg  the current step only.
              lg+    all seven.
            The earlier version stopped at "current step only" because all
            seven wanted ~807px inside the editor's max-w-3xl column (720px
            usable), and that cap does not grow with the viewport, so there
            was no screen size at which they fitted. The fix was not to
            squeeze the labels but to stop making the rail obey the prose
            measure: the editor's sticky bar now widens to max-w-5xl from
            `lg` (see story-edit-form.tsx) and the preview page was already
            max-w-5xl, which is ~976px of usable width -- room for all seven
            with the short wording above.
            Note what is NOT here: no `min-w-0`. Each <li> stays `shrink-0`,
            so a label that ever did run out of room would push the <ol>'s
            scrollWidth past its clientWidth and hit the overflow safety net
            below, rather than overflowing its own box the way
            "Review & submit" did when it printed 18px outside the rail. */}
        <span
          aria-hidden="true"
          className={`hidden text-xs font-medium whitespace-nowrap ${
            isCurrent
              ? "text-foreground sm:inline"
              : isDone
                ? "text-foreground/70 lg:inline"
                : "text-muted-foreground lg:inline"
          }`}
        >
          {RAIL_LABELS[id]}
        </span>
      </>
    );
  }

  return (
    <nav aria-label="Story progress" className="w-full">
      {/* Compact summary. Always rendered, at every width: it is the only
          thing on a phone, and next to the full rail it is still the line
          that tells you where you are without counting circles. */}
      <p className="text-xs font-medium text-muted-foreground">
        Step {currentIndex + 1} of {STORY_STEPS.length}
        <span className="text-foreground">
          {" "}
          · {STORY_STEPS[currentIndex].label}
        </span>
      </p>

      {/* `overflow-x-auto` is the safety net, not the plan: the rail is
          tuned below to fit its container at every breakpoint, and this
          stops a
          future longer label (or a translation) from spilling outside the
          container the way "Review & submit" did -- it ran 18px past the
          right edge because `min-w-0` let each item shrink while its label
          was `whitespace-nowrap`, so the text overflowed its own box. The
          items are focusable links/buttons, so keyboard users reach a
          scrolled-off step by tabbing and the browser scrolls it into view;
          no tabIndex of its own is needed here. */}
      <ol className="mt-2 flex items-center gap-1 overflow-x-auto">
        {STORY_STEPS.map((step, index) => {
          const { isCurrent } = stateOf(step.id, index);
          const inner = <Face id={step.id} index={index} />;
          const shared =
            "flex items-center gap-2 rounded-full px-0.5 py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-accent";
          const href = hrefs?.[step.id];
          const isLocked = locked.has(step.id);

          return (
            <li key={step.id} className="flex shrink-0 items-center gap-1">
              {isLocked ? (
                // A plain <span>, not a disabled <button>: there is nothing
                // to activate here, so it should not be in the tab order at
                // all. `title` gives a pointer user the same explanation the
                // accessible name already carries.
                <span
                  aria-label={labelFor(step.id, index)}
                  title="Finish the steps before it, then use “Review & submit”."
                  className={`${shared} cursor-not-allowed opacity-45`}
                >
                  {inner}
                </span>
              ) : href ? (
                <Link
                  href={href}
                  aria-label={labelFor(step.id, index)}
                  aria-current={isCurrent ? "step" : undefined}
                  className={shared}
                >
                  {inner}
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => onSelect?.(step.id)}
                  aria-label={labelFor(step.id, index)}
                  aria-current={isCurrent ? "step" : undefined}
                  className={shared}
                >
                  {inner}
                </button>
              )}
              {index < STORY_STEPS.length - 1 && (
                <span
                  aria-hidden="true"
                  className={`h-px w-2 shrink-0 sm:w-3 lg:w-4 ${
                    index < currentIndex ? "bg-accent/60" : "bg-border-subtle"
                  }`}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
