"use client";

import { signOutAction } from "@/app/(auth)/actions";

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
