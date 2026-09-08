"use client";

import { useActionState } from "react";
import {
  setUsernameAction,
  type AccountFormState,
} from "@/app/(contributor)/actions";

const initialState: AccountFormState = {};

/**
 * Optional sign-in username. Kept as its own small form rather than a field
 * inside ProfileForm because it writes to a different table with different
 * RLS (see supabase/migrations/20260909090000_usernames.sql) — folding it
 * in would mean one submit doing two writes that can fail independently.
 */
export function UsernameForm({ username }: { username: string }) {
  const [state, formAction, pending] = useActionState(
    setUsernameAction,
    initialState,
  );

  return (
    <form action={formAction} className="mt-4 space-y-3" noValidate>
      <div>
        <label htmlFor="username" className="block text-sm font-medium">
          Username
        </label>
        <input
          id="username"
          name="username"
          type="text"
          maxLength={30}
          autoComplete="username"
          defaultValue={username}
          placeholder="your-username"
          className="mt-1 w-full rounded-xl border border-border-subtle bg-surface px-3 py-2 focus:border-accent focus:outline-none"
        />
        <p className="mt-1 text-xs text-foreground/55">
          3-30 lowercase letters, numbers, underscores, or hyphens. This is
          never shown to anyone else — it only gives you a second way to sign in
          besides your email.
        </p>
      </div>

      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state.success && (
        <p role="status" className="text-sm text-fern">
          {state.success}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="journiq-button bg-accent text-sm text-accent-foreground disabled:opacity-60"
      >
        {pending ? "Saving…" : username ? "Change username" : "Set username"}
      </button>
    </form>
  );
}
