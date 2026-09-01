"use client";

import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/lib/hooks/use-prefers-reduced-motion";

// Four plates: the three inherited landscapes plus Auckland's waterfront, so
// the sequence carries a city as well as backcountry -- most working-holiday
// arrivals start in a city, and a hero of nothing but empty alpine valleys
// quietly misrepresents the catalogue.
//
// EVERY IMAGE HERE HAS BEEN LOOKED AT, not merely checked for a 200. That
// distinction cost something: a candidate that loaded perfectly turned out to
// be a portrait of an alpaca, and another was an aurora over what is plainly
// not New Zealand. On a page whose entire claim is "these places are real and
// these accounts are true," a stock photo from the wrong hemisphere is a
// content bug, not a decorative one. Look at the picture before you ship it.
//
// These are still remote Unsplash URLs, inherited from the previous hero.
// That is fine for a founding catalogue and it is NOT fine forever: hotlinking
// puts a third party in the critical path of the first viewport. When the real
// founding-catalogue imagery lands, these should become local, processed
// assets served from our own storage like every story image already is.
const SLIDES = [
  // Alpine lake and cloud.
  "https://images.unsplash.com/photo-1469521669194-babb45599def?auto=format&fit=crop&w=2400&q=85",
  // Auckland waterfront at dusk, Sky Tower visible.
  "https://images.unsplash.com/photo-1507699622108-4be3abd695ad?auto=format&fit=crop&w=2400&q=85",
  // Open road through hill country.
  "https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=2400&q=85",
  // Coastal light.
  "https://images.unsplash.com/photo-1506377247377-2a5b3b417ebb?auto=format&fit=crop&w=2400&q=85",
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
        className={`hero-slideshow absolute inset-0 -z-10 overflow-hidden bg-[#05070a] ${paused ? "is-paused" : ""}`}
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
      {/* Real position indicator, not decoration -- ticks the same `index`
          state that drives which slide is showing, so it's wrong the
          instant it drifts from the photo instead of being safely inert. */}
      <div
        className="absolute top-24 right-4 z-10 flex flex-col items-end gap-1.5 sm:right-6"
        aria-hidden="true"
      >
        {SLIDES.map((url, slideIndex) => (
          <span
            key={url}
            className={`font-mono text-xs tabular-nums transition-colors ${
              slideIndex === index ? "font-bold text-accent" : "text-white/35"
            }`}
          >
            0{slideIndex + 1}
          </span>
        ))}
      </div>
      {!reduced ? (
        <button
          type="button"
          onClick={() => setPaused((current) => !current)}
          aria-pressed={paused}
          aria-label={label}
          title={label}
          className="absolute right-4 bottom-4 z-10 flex h-9 items-center gap-2 rounded-full border border-white/35 bg-black/40 px-3.5 text-xs font-semibold text-white backdrop-blur-sm transition-colors hover:border-white/70 hover:bg-black/60 sm:right-6 sm:bottom-6"
        >
          {/* Drawn, not a Unicode glyph: ▶ and Ⅱ render at different
              optical weights across platforms and read as text to a
              screen reader that ignores aria-hidden. */}
          <svg
            viewBox="0 0 12 12"
            className="h-3 w-3 shrink-0"
            fill="currentColor"
            aria-hidden="true"
          >
            {paused ? (
              <path d="M3 1.6 10 6l-7 4.4z" />
            ) : (
              <>
                <rect x="2.6" y="1.6" width="2.6" height="8.8" rx="0.7" />
                <rect x="6.8" y="1.6" width="2.6" height="8.8" rx="0.7" />
              </>
            )}
          </svg>
          <span className="hidden sm:inline">
            {paused ? "Play motion" : "Pause motion"}
          </span>
        </button>
      ) : null}
    </>
  );
}
