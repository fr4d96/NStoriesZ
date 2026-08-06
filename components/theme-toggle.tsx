"use client";

import { useSyncExternalStore } from "react";
import { controlToneClasses } from "@/components/ui-tone";

type Theme = "light" | "dark";
type Listener = () => void;

const listeners = new Set<Listener>();

// The DOM attribute is the source of truth (set by the blocking inline
// script in app/layout.tsx before first paint). useSyncExternalStore lets
// this component read it without a setState-in-effect round trip: React
// renders getServerSnapshot() on the server and on the client's first
// (hydrating) pass, then transparently swaps to getSnapshot()'s real value
// right after -- no hydration-mismatch warning, no extra render triggered
// by our own code.
function getSnapshot(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function getServerSnapshot(): Theme {
  return "light";
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setTheme(next: Theme) {
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem("journiq-theme", next);
  } catch {
    // ignore (private browsing / storage disabled)
  }
  listeners.forEach((listener) => listener());
}

export function ThemeToggle({ inverted = false }: { inverted?: boolean }) {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const isDark = theme === "dark";
  const label = isDark ? "Switch to light mode" : "Switch to dark mode";
  const toneClasses = controlToneClasses(inverted);

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={label}
      title={label}
      className={`flex h-9 w-9 items-center justify-center rounded-full border transition-transform hover:-translate-y-0.5 ${toneClasses}`}
    >
      <span aria-hidden="true">{isDark ? "☀" : "☾"}</span>
    </button>
  );
}
