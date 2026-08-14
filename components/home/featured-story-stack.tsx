"use client";

import { useRef, useState } from "react";
import { FeaturedStorySlide } from "@/components/home/featured-story-slide";
import type { StoryCardData } from "@/components/story/story-card";
import { usePrefersReducedMotion } from "@/lib/hooks/use-prefers-reduced-motion";
import { ArrowRightIcon } from "@/components/icons";

type StackVars = React.CSSProperties & Record<string, string | number>;

const DEPTH_STYLE: Record<number, StackVars> = {
  0: {
    "--stack-x": "0px",
    "--stack-y": "0px",
    "--stack-scale": 1,
    "--stack-rotate": "0deg",
    zIndex: 6,
    opacity: 1,
  },
  1: {
    "--stack-x": "14px",
    "--stack-y": "14px",
    "--stack-scale": 0.97,
    "--stack-rotate": "1.6deg",
    zIndex: 5,
    opacity: 0.95,
  },
  2: {
    "--stack-x": "-13px",
    "--stack-y": "27px",
    "--stack-scale": 0.94,
    "--stack-rotate": "-2deg",
    zIndex: 4,
    opacity: 0.85,
  },
  3: {
    "--stack-x": "9px",
    "--stack-y": "38px",
    "--stack-scale": 0.91,
    "--stack-rotate": "1deg",
    zIndex: 3,
    opacity: 0.7,
  },
};

const HIDDEN_STYLE: StackVars = {
  "--stack-y": "48px",
  "--stack-scale": 0.88,
  zIndex: 1,
  opacity: 0,
  pointerEvents: "none",
};

const DRAG_THRESHOLD = 80;
const VELOCITY_THRESHOLD = 0.55;
const THROW_DURATION_MS = 520;

function mod(n: number, m: number) {
  return ((n % m) + m) % m;
}

/**
 * Drag/swipe, depth-layered card stack -- the top card can be dragged left
 * or right (pointer events), thrown past a distance/velocity threshold, or
 * advanced with the prev/next buttons, dots, or arrow keys. Position is
 * tracked as a plain `slide` index (not read back from layout, unlike the
 * scroll-snap carousel this replaces) since nothing here scrolls.
 */
export function FeaturedStoryStack({ stories }: { stories: StoryCardData[] }) {
  const count = stories.length;
  const [slide, setSlide] = useState(0);
  const [throwState, setThrowState] = useState<{
    id: string;
    direction: "left" | "right";
  } | null>(null);
  const animatingRef = useRef(false);
  const reduced = usePrefersReducedMotion();
  const dragRef = useRef<{
    id: string;
    pointerId: number;
    startX: number;
    lastX: number;
    startedAt: number;
  } | null>(null);
  // Set once a press travels far enough to count as a drag rather than a tap,
  // so the click fired on release does not follow a link the finger happens
  // to be over.
  const didDragRef = useRef(false);

  function moveStack(direction: 1 | -1, targetIndex?: number) {
    if (animatingRef.current || count < 2) return;
    animatingRef.current = true;
    const outgoing = stories[slide];
    setThrowState({
      id: outgoing.story_id,
      direction: direction > 0 ? "left" : "right",
    });
    const nextSlide =
      targetIndex !== undefined
        ? mod(targetIndex, count)
        : mod(slide + direction, count);
    setSlide(nextSlide);
    window.setTimeout(
      () => {
        setThrowState(null);
        animatingRef.current = false;
      },
      reduced ? 0 : THROW_DURATION_MS,
    );
  }

  function goTo(index: number) {
    if (index === slide || animatingRef.current) return;
    const forward = mod(index - slide, count);
    const backward = mod(slide - index, count);
    moveStack(forward <= backward ? 1 : -1, index);
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      moveStack(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveStack(-1);
    }
  }

  // Named/attached directly to their JSX event props (not wrapped in an
  // inline closure that also threads extra arguments) so the react-hooks
  // purity check recognizes these as real event handlers -- the story id
  // and active flag they need come from the card's own data-* attributes
  // instead of a closure. Timing uses the event's own `timeStamp` rather
  // than calling performance.now(), which the same purity check treats as
  // an impure global regardless of call site.
  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const card = event.currentTarget;
    if (card.dataset.active !== "true" || event.button !== 0) return;
    // Only real controls opt out of dragging: the story title and the
    // "Read story" button. Everything else on the card -- photo, excerpt,
    // attribution, empty space -- is drag surface.
    if ((event.target as HTMLElement).closest("a,button")) return;
    didDragRef.current = false;
    dragRef.current = {
      id: card.dataset.storyId ?? "",
      pointerId: event.pointerId,
      startX: event.clientX,
      lastX: event.clientX,
      startedAt: event.timeStamp,
    };
    card.classList.add("is-dragging");
    try {
      card.setPointerCapture(event.pointerId);
    } catch {
      // not supported in this environment (e.g. jsdom) -- drag still works
    }
  }

  // The drag offset is written straight to the card's CSS custom properties
  // rather than held in React state. A pointermove fires on every frame (and
  // faster on high-rate pointers); routing each one through setState
  // re-rendered all five stacked cards per frame, which is what made the
  // drag feel like it was catching rather than tracking the cursor. Writing
  // the two custom properties touches one element and stays on the
  // compositor, since `.story-stack-card` composes them into its transform.
  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.lastX = event.clientX;
    const travel = event.clientX - drag.startX;
    const distance = Math.max(-320, Math.min(320, travel));
    // Past a few pixels this is a drag, not a tap.
    if (Math.abs(travel) > 6) didDragRef.current = true;
    const card = event.currentTarget;
    card.style.setProperty("--drag-x", `${distance}px`);
    card.style.setProperty("--drag-rotate", `${distance / 24}deg`);
  }

  function clearDragTransform(card: HTMLDivElement) {
    card.classList.remove("is-dragging");
    card.style.removeProperty("--drag-x");
    card.style.removeProperty("--drag-rotate");
  }

  function handleClickCapture(event: React.MouseEvent<HTMLDivElement>) {
    if (!didDragRef.current) return;
    didDragRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  function releaseCapture(event: React.PointerEvent<HTMLDivElement>) {
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // pointer capture may already be released
    }
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    const distance = drag.lastX - drag.startX;
    const elapsed = Math.max(1, event.timeStamp - drag.startedAt);
    const velocity = distance / elapsed;
    releaseCapture(event);
    clearDragTransform(event.currentTarget);
    // The velocity check also requires a minimum distance -- otherwise a
    // sub-pixel jitter paired with a near-zero elapsed time (two pointer
    // events firing on the same frame) computes as an enormous velocity and
    // throws the card on what was really just a tap.
    const isFlick =
      Math.abs(distance) > 12 && Math.abs(velocity) > VELOCITY_THRESHOLD;
    if (Math.abs(distance) > DRAG_THRESHOLD || isFlick) {
      moveStack(distance < 0 ? 1 : -1);
    }
  }

  function handlePointerCancel(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    releaseCapture(event);
    clearDragTransform(event.currentTarget);
  }

  if (count === 0) return null;

  const active = stories[slide];

  return (
    <div
      role="region"
      aria-roledescription="carousel"
      aria-label="Featured Working Holiday stories"
      className="relative"
    >
      <div
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="relative mx-auto h-[735px] max-w-[1080px] outline-none sm:h-[620px]"
      >
        {stories.map((story, index) => {
          const depth = mod(index - slide, count);
          const isActive = depth === 0;
          const isThrowing = throwState?.id === story.story_id;
          // --drag-x / --drag-rotate are written imperatively during a drag
          // (see handlePointerMove) so a pointermove never re-renders this
          // list; they fall back to the resting values declared on
          // `.story-stack-card` as soon as they are removed.
          const style: StackVars = {
            ...(depth <= 3 ? DEPTH_STYLE[depth] : HIDDEN_STYLE),
          };
          const throwClass = isThrowing
            ? throwState?.direction === "left"
              ? "is-throwing-left"
              : "is-throwing-right"
            : "";

          return (
            <div
              key={story.story_id}
              data-testid="stack-card"
              data-active={isActive}
              data-story-id={story.story_id}
              className={`story-stack-card absolute inset-0 ${isActive ? "cursor-grab" : ""} ${throwClass}`}
              style={style}
              aria-hidden={!isActive}
              inert={!isActive}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
              onClickCapture={handleClickCapture}
            >
              <FeaturedStorySlide story={story} priority={index === 0} />
            </div>
          );
        })}
      </div>

      <div aria-live="polite" className="sr-only">
        {`Story ${slide + 1} of ${count}: ${active.title}`}
      </div>

      <div className="mt-16 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          aria-label="Previous stories"
          onClick={() => moveStack(-1)}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-border-subtle text-foreground transition-transform hover:-translate-y-0.5 hover:bg-surface-muted"
        >
          <ArrowRightIcon className="h-4 w-4 rotate-180" />
        </button>
        <div className="flex items-center gap-1.5">
          {stories.map((story, index) => (
            <button
              key={story.story_id}
              type="button"
              aria-label={`Go to story ${index + 1} of ${count}`}
              aria-current={index === slide ? "true" : undefined}
              onClick={() => goTo(index)}
              className={`h-1.5 rounded-full transition-all hover:scale-125 ${
                index === slide ? "w-5 bg-accent" : "w-1.5 bg-border-subtle"
              }`}
            />
          ))}
        </div>
        <button
          type="button"
          aria-label="Next stories"
          onClick={() => moveStack(1)}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-border-subtle text-foreground transition-transform hover:-translate-y-0.5 hover:bg-surface-muted"
        >
          <ArrowRightIcon className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-3 text-center text-xs text-foreground/50">
        Drag the front card, or use the arrows.
      </p>
    </div>
  );
}
