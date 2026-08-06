"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Fade-and-slide-in-on-scroll wrapper, ported from
 * journiq_landing_page_card_stack.html's `.reveal`/IntersectionObserver
 * pattern. An element already in view on first paint reveals immediately
 * (IntersectionObserver fires on `observe()` for already-intersecting
 * elements, no scroll required). `prefers-reduced-motion` is handled by the
 * existing global override in app/globals.css (forces near-zero transition
 * duration for every element), so this component doesn't need its own
 * reduced-motion branch -- the end state is the same either way.
 */
export function Reveal({
  children,
  className = "",
  direction = "up",
  delayMs = 0,
}: {
  children: React.ReactNode;
  className?: string;
  direction?: "up" | "left" | "right";
  delayMs?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.unobserve(el);
        }
      },
      { threshold: 0.14, rootMargin: "0px 0px -7% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const hiddenTranslate =
    direction === "left"
      ? "-translate-x-8"
      : direction === "right"
        ? "translate-x-8"
        : "translate-y-6";

  return (
    <div
      ref={ref}
      style={delayMs ? { transitionDelay: `${delayMs}ms` } : undefined}
      className={`transition-all duration-700 ease-out ${
        visible
          ? "translate-x-0 translate-y-0 opacity-100"
          : `opacity-0 ${hiddenTranslate}`
      } ${className}`}
    >
      {children}
    </div>
  );
}
