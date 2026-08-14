"use client";

import { useActionState } from "react";
import { createDraftAction, type NewStoryFormState } from "./actions";

const initialState: NewStoryFormState = {};

export function NewStoryForm() {
  const [state, formAction, pending] = useActionState(
    createDraftAction,
    initialState,
  );

  return (
    <form action={formAction} className="mt-6 space-y-4">
      <div>
        <label htmlFor="title" className="block text-sm font-medium">
          Working title
        </label>
        <input
          id="title"
          name="title"
          type="text"
          required
          maxLength={200}
          placeholder="My Working Holiday in New Zealand"
          className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 text-base focus:border-black/40 focus:outline-none dark:border-white/15 dark:bg-transparent dark:focus:border-white/40"
        />
        <p className="mt-1 text-sm text-black/60 dark:text-white/60">
          You can change this any time — it just gets you started.
        </p>
      </div>

      {state.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground transition-opacity disabled:opacity-50 sm:w-auto"
      >
        {pending ? "Starting…" : "Start writing"}
      </button>
    </form>
  );
}
