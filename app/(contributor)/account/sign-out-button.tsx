"use client";

import { signOutAction } from "@/app/(auth)/actions";
import { controlToneClasses } from "@/components/ui-tone";

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <button
        type="submit"
        className="journiq-button border border-border-subtle text-sm"
      >
        Sign out
      </button>
    </form>
  );
}

const SignOutIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-4 w-4"
    aria-hidden="true"
  >
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

/**
 * Icon-only variant, styled to match ThemeToggle's round control (see
 * components/theme-toggle.tsx) since it always sits directly beside it in
 * ContributorNav.
 */
export function SignOutIconButton({
  inverted = false,
}: {
  inverted?: boolean;
}) {
  const toneClasses = controlToneClasses(inverted);
  return (
    <form action={signOutAction}>
      <button
        type="submit"
        aria-label="Sign out"
        title="Sign out"
        className={`flex h-9 w-9 items-center justify-center rounded-full border transition-transform hover:-translate-y-0.5 ${toneClasses}`}
      >
        <SignOutIcon />
      </button>
    </form>
  );
}
