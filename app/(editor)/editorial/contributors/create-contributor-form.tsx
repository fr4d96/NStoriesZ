"use client";

import { useActionState } from "react";
import {
  createUnlinkedContributorAction,
  type ContributorsFormState,
} from "./actions";

const initialState: ContributorsFormState = {};

export function CreateContributorForm() {
  const [state, formAction, pending] = useActionState(
    createUnlinkedContributorAction,
    initialState,
  );

  return (
    <form
      action={formAction}
      className="mt-4 flex flex-col gap-3 rounded-md border border-black/10 p-4 sm:flex-row sm:items-end dark:border-white/10"
    >
      <div className="flex-1">
        <label
          htmlFor="create-contributor-name"
          className="block text-sm font-medium"
        >
          New unlinked contributor
        </label>
        <input
          id="create-contributor-name"
          name="displayName"
          type="text"
          required
          maxLength={120}
          placeholder="Display name"
          className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/15 dark:bg-transparent"
        />
      </div>
      <select
        name="attributionType"
        defaultValue="display_name"
        className="rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/15 dark:bg-transparent"
      >
        <option value="real_name">Real name</option>
        <option value="display_name">Display name</option>
        <option value="pseudonym">Pseudonym</option>
        <option value="anonymous">Anonymous</option>
      </select>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center justify-center rounded-md border border-black/15 px-4 py-2 text-sm font-semibold disabled:opacity-60 dark:border-white/15"
      >
        {pending ? "Creating…" : "Create"}
      </button>
      {state.error && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}
      {state.success && (
        <p role="status" className="text-xs text-green-700 dark:text-green-400">
          {state.success}
        </p>
      )}
    </form>
  );
}
