"use client";

import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/lib/hooks/use-prefers-reduced-motion";

// Same three images as journiq_landing_page_card_stack.html's hero slideshow.
const SLIDES = [
  "https://images.unsplash.com/photo-1469521669194-babb45599def?auto=format&fit=crop&w=2000&q=88",
  "https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=2000&q=88",
  "https://images.unsplash.com/photo-1506377247377-2a5b3b417ebb?auto=format&fit=crop&w=2000&q=88",
];

const SLIDE_INTERVAL_MS = 6500;

/**
 * Cross-fading, Ken-Burns hero photo slideshow -- autoplay with a visible
 * pause control (never auto-advance with no way to stop it), respects
 * prefers-reduced-motion (starts paused, hides the toggle, matching
 * app/globals.css's global reduced-motion override), and pauses while the
 * tab is hidden.
 */
export function HeroSlideshow() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduced = usePrefersReducedMotion();
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    function stop() {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    function start() {
      if (reduced || paused || document.hidden || timerRef.current !== null)
        return;
      timerRef.current = window.setInterval(() => {
        setIndex((current) => (current + 1) % SLIDES.length);
      }, SLIDE_INTERVAL_MS);
    }
    function onVisibilityChange() {
      if (document.hidden) stop();
      else start();
    }
    start();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [reduced, paused]);

  const label = paused ? "Play hero animation" : "Pause hero animation";

  return (
    <>
      {/* Background layer sits at -z-10 so hero text/CTAs paint above it.
          The pause button below is a SEPARATE sibling at the hero
          <section>'s top level (not nested inside this div) -- nesting it
          in here previously put it behind the hero's text-content wrapper,
          which is a later, higher-stacking sibling of this whole div and
          covers it for hit-testing even where that wrapper is visually
          transparent, so clicks never reached the button. */}
      <div
        className={`hero-slideshow absolute inset-0 -z-10 overflow-hidden bg-[#0b251e] ${paused ? "is-paused" : ""}`}
      >
        {SLIDES.map((url, slideIndex) => (
          <div
            key={url}
            aria-hidden="true"
            className={`hero-slide ${slideIndex === index ? "is-active" : ""}`}
            style={{ backgroundImage: `url('${url}')` }}
          />
        ))}
        <div className="hero-overlay" aria-hidden="true" />
      </div>
      {!reduced ? (
        <button
          type="button"
          onClick={() => setPaused((current) => !current)}
          aria-pressed={paused}
          aria-label={label}
          title={label}
          className="absolute right-4 bottom-4 z-10 flex h-9 items-center gap-1.5 rounded-full border border-white/40 bg-black/35 px-3 text-xs font-semibold text-white backdrop-blur-sm sm:right-6 sm:bottom-6"
        >
          <span aria-hidden="true">{paused ? "▶" : "Ⅱ"}</span>
          <span className="hidden sm:inline">
            {paused ? "Play motion" : "Pause motion"}
          </span>
        </button>
      ) : null}
    </>
  );
}
