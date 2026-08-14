"use client";

import { useActionState, useState } from "react";
import type { ContributorForEditorial } from "@/lib/story/editorial-queries";
import {
  createEditorialImportAction,
  type NewImportFormState,
} from "./actions";

const initialState: NewImportFormState = {};

export function NewImportForm({
  contributors,
}: {
  contributors: ContributorForEditorial[];
}) {
  const [state, formAction, pending] = useActionState(
    createEditorialImportAction,
    initialState,
  );
  const [mode, setMode] = useState<"existing" | "new">(
    contributors.length > 0 ? "existing" : "new",
  );

  return (
    <form action={formAction} className="mt-6 space-y-6">
      {state.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}

      <div>
        <label htmlFor="new-import-title" className="block text-sm font-medium">
          Title
        </label>
        <input
          id="new-import-title"
          name="title"
          type="text"
          required
          maxLength={200}
          className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 dark:border-white/15 dark:bg-transparent"
        />
      </div>

      <fieldset>
        <legend className="text-sm font-medium">Contributor</legend>
        <div className="mt-1 flex gap-4 text-sm">
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name="contributorMode"
              value="existing"
              checked={mode === "existing"}
              onChange={() => setMode("existing")}
              disabled={contributors.length === 0}
            />
            Existing contributor
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name="contributorMode"
              value="new"
              checked={mode === "new"}
              onChange={() => setMode("new")}
            />
            New (unlinked) contributor
          </label>
        </div>

        {mode === "existing" ? (
          <select
            name="existingContributorId"
            required
            className="mt-3 w-full rounded-md border border-black/15 px-3 py-2 dark:border-white/15 dark:bg-transparent"
          >
            {contributors.length === 0 && (
              <option value="">No contributors yet</option>
            )}
            {contributors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.displayName} {c.isLinked ? "(linked)" : "(unlinked)"}
              </option>
            ))}
          </select>
        ) : (
          <div className="mt-3 space-y-3">
            <div>
              <label
                htmlFor="new-contributor-name"
                className="block text-sm font-medium"
              >
                Display name
              </label>
              <input
                id="new-contributor-name"
                name="newContributorDisplayName"
                type="text"
                required
                maxLength={120}
                className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 dark:border-white/15 dark:bg-transparent"
              />
            </div>
            <div>
              <label
                htmlFor="new-contributor-attribution"
                className="block text-sm font-medium"
              >
                Attribution type
              </label>
              <select
                id="new-contributor-attribution"
                name="newContributorAttributionType"
                defaultValue="display_name"
                className="mt-1 w-full rounded-md border border-black/15 px-3 py-2 dark:border-white/15 dark:bg-transparent"
              >
                <option value="real_name">Real name</option>
                <option value="display_name">Display name</option>
                <option value="pseudonym">Pseudonym</option>
                <option value="anonymous">Anonymous</option>
              </select>
            </div>
          </div>
        )}
      </fieldset>

      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground disabled:opacity-60"
      >
        {pending ? "Creating…" : "Create Import Draft"}
      </button>
    </form>
  );
}
