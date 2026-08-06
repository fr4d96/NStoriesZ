"use client";

import { useSyncedBoolean } from "@/lib/hooks/use-synced-boolean";

function subscribe(callback: () => void) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

function getSnapshot() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Reactive to a live OS setting change (unlike a one-shot matchMedia() read).
export function usePrefersReducedMotion(): boolean {
  return useSyncedBoolean(subscribe, getSnapshot);
}
