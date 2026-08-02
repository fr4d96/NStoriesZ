"use client";

import { useActionState } from "react";
import {
  createOwnContributorAction,
  updateOwnContributorAction,
  type AccountFormState,
} from "@/app/(contributor)/actions";
import { contributorAttributionTypes } from "@/lib/validation/profile";

const initialState: AccountFormState = {};

const attributionLabels: Record<
  (typeof contributorAttributionTypes)[number],
  string
> = {
  real_name: "My real name",
  display_name: "A display name",
  pseudonym: "A pseudonym",
  anonymous: "Anonymous",
};

export function ContributorForm({
  existing,
}: {
  existing: { displayName: string; attributionType: string } | null;
}) {
  const action = existing
    ? updateOwnContributorAction
    : createOwnContributorAction;
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="mt-4 space-y-5" noValidate>
      <div>
        <label
          htmlFor="contributorDisplayName"
          className="block text-sm font-medium"
        >
          How your name appears on stories
        </label>
        <input
          id="contributorDisplayName"
          name="displayName"
          type="text"
          maxLength={120}
          required
          defaultValue={existing?.displayName ?? ""}
          className="mt-1 w-full rounded-md border border-black/20 px-3 py-2 dark:border-white/20"
        />
      </div>

      <fieldset>
        <legend className="text-sm font-medium">Attribution type</legend>
        <div className="mt-2 space-y-2">
          {contributorAttributionTypes.map((type) => (
            <label key={type} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="attributionType"
                value={type}
                defaultChecked={
                  existing
                    ? existing.attributionType === type
                    : type === "display_name"
                }
                className="h-4 w-4"
              />
              {attributionLabels[type]}
            </label>
          ))}
        </div>
      </fieldset>

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
        {pending
          ? "Saving…"
          : existing
            ? "Update contributor identity"
            : "Set up contributor identity"}
      </button>
    </form>
  );
}
