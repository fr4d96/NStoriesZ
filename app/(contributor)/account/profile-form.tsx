"use client";

import { useActionState } from "react";
import {
  updateProfileAction,
  type AccountFormState,
} from "@/app/(contributor)/actions";

const initialState: AccountFormState = {};

export function ProfileForm({
  displayName,
  bio,
  homeCountryCode,
  publicProfileEnabled,
  publicSlug,
}: {
  displayName: string;
  bio: string;
  homeCountryCode: string;
  publicProfileEnabled: boolean;
  publicSlug: string;
}) {
  const [state, formAction, pending] = useActionState(
    updateProfileAction,
    initialState,
  );

  return (
    <form action={formAction} className="mt-4 space-y-5" noValidate>
      <div>
        <label htmlFor="displayName" className="block text-sm font-medium">
          Display name
        </label>
        <input
          id="displayName"
          name="displayName"
          type="text"
          maxLength={120}
          required
          defaultValue={displayName}
          className="mt-1 w-full rounded-md border border-black/20 px-3 py-2 dark:border-white/20"
        />
      </div>

      <div>
        <label htmlFor="homeCountryCode" className="block text-sm font-medium">
          Home country code
        </label>
        <input
          id="homeCountryCode"
          name="homeCountryCode"
          type="text"
          maxLength={2}
          required
          defaultValue={homeCountryCode}
          className="mt-1 w-24 rounded-md border border-black/20 px-3 py-2 uppercase dark:border-white/20"
        />
        <p className="mt-1 text-xs text-black/60 dark:text-white/60">
          2-letter code, e.g. MY.
        </p>
      </div>

      <div>
        <label htmlFor="bio" className="block text-sm font-medium">
          Bio
        </label>
        <textarea
          id="bio"
          name="bio"
          rows={4}
          maxLength={2000}
          defaultValue={bio}
          className="mt-1 w-full rounded-md border border-black/20 px-3 py-2 dark:border-white/20"
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          id="publicProfileEnabled"
          name="publicProfileEnabled"
          type="checkbox"
          defaultChecked={publicProfileEnabled}
          className="h-4 w-4"
        />
        <label htmlFor="publicProfileEnabled" className="text-sm font-medium">
          Make my profile public
        </label>
      </div>

      <div>
        <label htmlFor="publicSlug" className="block text-sm font-medium">
          Public profile URL
        </label>
        <input
          id="publicSlug"
          name="publicSlug"
          type="text"
          maxLength={60}
          defaultValue={publicSlug}
          className="mt-1 w-full rounded-md border border-black/20 px-3 py-2 dark:border-white/20"
        />
        <p className="mt-1 text-xs text-black/60 dark:text-white/60">
          Required to make your profile public. Nothing else is shown publicly
          unless you enable the toggle above.
        </p>
      </div>

      {state.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}
      {state.success && (
        <p role="status" className="text-sm text-green-700 dark:text-green-400">
          {state.success}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-black px-4 py-2 text-sm text-white hover:bg-black/80 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-white/80"
      >
        {pending ? "Saving…" : "Save profile"}
      </button>
    </form>
  );
}
