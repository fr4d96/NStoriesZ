"use client";

import { useSyncExternalStore } from "react";

// Shared scaffolding for "subscribe to a browser event, read a boolean
// snapshot" hooks (prefers-reduced-motion, scroll position, etc.) without a
// setState-in-effect round trip -- React re-renders whenever the subscribed
// store's snapshot changes. Server snapshot is always false; callers needing
// a different SSR default shouldn't use this helper.
export function useSyncedBoolean(
  subscribe: (callback: () => void) => () => void,
  getSnapshot: () => boolean,
): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
