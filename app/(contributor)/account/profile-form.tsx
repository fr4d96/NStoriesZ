"use client";

import { useActionState } from "react";
import {
  updateProfileAction,
  type AccountFormState,
} from "@/app/(contributor)/actions";

const initialState: AccountFormState = {};

/**
 * Account settings, and deliberately nothing else.
 *
 * This form used to carry a bio, an avatar, a home country, a "make my
 * profile public" toggle and a public slug -- all writing to `profiles`,
 * none of which any public page read. /contributors/[slug] renders the
 * `contributors` row, so every one of those fields moved to ContributorForm
 * in 20260910090000. What is left here is the account's own label.
 */
export function ProfileForm({ displayName }: { displayName: string }) {
  const [state, formAction, pending] = useActionState(
    updateProfileAction,
    initialState,
  );

  return (
    <form action={formAction} className="mt-4 space-y-5" noValidate>
      <div>
        <label htmlFor="displayName" className="block text-sm font-medium">
          Account name
        </label>
        <p className="mt-1 text-xs text-foreground/55">
          Just for your account. Readers never see this — the name on your
          stories is set on the{" "}
          <a
            href="#contributor-identity"
            className="underline underline-offset-2"
          >
            Contributor identity tab
          </a>
          .
        </p>
        <input
          id="displayName"
          name="displayName"
          type="text"
          maxLength={120}
          required
          defaultValue={displayName}
          className="mt-2 w-full rounded-xl border border-border-subtle bg-surface px-3 py-2 focus:border-accent focus:outline-none"
        />
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
        {pending ? "Saving…" : "Update profile"}
      </button>
    </form>
  );
}
