"use client";

import { useActionState } from "react";
import {
  submitOwnConsentAction,
  type ConsentActionState,
} from "@/app/(contributor)/stories/[id]/preview/actions";

const initialState: ConsentActionState = {};

export type SubmitConsentPanelProps = {
  storyId: string;
  revisionId: string;
  expectedVersion: number;
  hasMedia: boolean;
  isEditorialImport: boolean;
  /** Contextual label -- "Submit for review" for a normal first submission, "Approve & submit for moderation" for the contributor-review "approve" action. */
  submitLabel: string;
};

export function SubmitConsentPanel({
  storyId,
  revisionId,
  expectedVersion,
  hasMedia,
  isEditorialImport,
  submitLabel,
}: SubmitConsentPanelProps) {
  const [state, formAction, pending] = useActionState(
    submitOwnConsentAction,
    initialState,
  );

  return (
    <form
      action={formAction}
      className="rounded-md border border-black/10 p-4 dark:border-white/10"
    >
      <input type="hidden" name="storyId" value={storyId} />
      <input type="hidden" name="revisionId" value={revisionId} />
      <input type="hidden" name="expectedVersion" value={expectedVersion} />

      <h2 className="text-sm font-semibold">Publication permission</h2>
      <p className="mt-1 text-xs text-black/60 dark:text-white/60">
        Personal experience, not advice — your story will be reviewed before it
        appears publicly.
      </p>

      <label className="mt-3 flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="publicationConfirmed"
          required
          className="mt-0.5"
        />
        <span>
          I confirm I have the right to publish this story and give permission
          for it to be published on Journiq.
        </span>
      </label>

      {hasMedia && (
        <>
          <label className="mt-3 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="imageRightsConfirmed"
              required
              className="mt-0.5"
            />
            <span>
              I confirm I have the right to share every attached image publicly.
            </span>
          </label>
          <div className="mt-3">
            <label
              htmlFor="identifiable-people-state"
              className="block text-xs font-medium"
            >
              Do any photos show identifiable people?
            </label>
            <select
              id="identifiable-people-state"
              name="identifiablePeopleState"
              required
              className="mt-1 rounded-md border border-black/15 px-2 py-1 text-sm dark:border-white/15 dark:bg-transparent"
            >
              <option value="not_applicable">No identifiable people</option>
              <option value="confirmed">Yes — I have their permission</option>
            </select>
          </div>
        </>
      )}

      {isEditorialImport && (
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="editorialAssistanceConfirmed"
            required
            className="mt-0.5"
          />
          <span>
            I&apos;ve reviewed this editor-prepared version and confirm it
            reflects my story accurately.
          </span>
        </label>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-4 rounded-md bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 dark:bg-white dark:text-black"
      >
        {pending ? "Submitting…" : submitLabel}
      </button>

      {state.error && (
        <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}
      {state.success && (
        <p
          role="status"
          className="mt-2 text-sm text-green-700 dark:text-green-400"
        >
          {state.success}
        </p>
      )}
    </form>
  );
}
