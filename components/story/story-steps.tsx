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
        <span
          aria-hidden="true"
          className={`hidden text-xs font-medium whitespace-nowrap lg:inline ${
            isCurrent ? "text-foreground" : "text-muted-foreground"
          }`}
        >
          {STORY_STEPS[index].label}
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

      <ol className="mt-2 flex items-center gap-1">
        {STORY_STEPS.map((step, index) => {
          const { isCurrent } = stateOf(step.id, index);
          const inner = <Face id={step.id} index={index} />;
          const shared =
            "flex items-center gap-2 rounded-full px-1 py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-accent";
          const href = hrefs?.[step.id];
          const isLocked = locked.has(step.id);

          return (
            <li key={step.id} className="flex min-w-0 items-center gap-1">
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
                  className={`h-px w-3 shrink-0 lg:w-6 ${
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
