"use client";

import { useActionState, useState } from "react";
import {
  markReadyForContributorReviewAction,
  logEvidenceNoteAction,
  submitWithOfflineConfirmationAction,
  type EditorialActionState,
  type SubmitOfflineFormState,
} from "./editorial-actions";

const initialState: EditorialActionState = {};
const initialOfflineState: SubmitOfflineFormState = {};

export function EditorialControls({
  storyId,
  revisionId,
  version,
  lifecycleStatus,
  showMarkReady,
}: {
  storyId: string;
  revisionId: string;
  version: number;
  lifecycleStatus: string;
  showMarkReady: boolean;
}) {
  const [markReadyPending, setMarkReadyPending] = useState(false);
  const [markReadyMessage, setMarkReadyMessage] = useState<string | null>(null);
  const [noteState, noteFormAction, notePending] = useActionState(
    logEvidenceNoteAction,
    initialState,
  );
  const [offlineState, offlineFormAction, offlinePending] = useActionState(
    submitWithOfflineConfirmationAction,
    initialOfflineState,
  );
  const [showOfflineForm, setShowOfflineForm] = useState(false);

  async function handleMarkReady() {
    setMarkReadyPending(true);
    setMarkReadyMessage(null);
    const result = await markReadyForContributorReviewAction(storyId);
    setMarkReadyMessage(result.error ?? result.success ?? null);
    setMarkReadyPending(false);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 pt-8 sm:px-6">
      <div className="flex flex-wrap items-center gap-3">
        {showMarkReady && lifecycleStatus === "draft" && (
          <button
            type="button"
            onClick={handleMarkReady}
            disabled={markReadyPending}
            className="rounded-md border border-black/15 px-3 py-1.5 text-sm font-medium disabled:opacity-60 dark:border-white/15"
          >
            {markReadyPending
              ? "Sending…"
              : "Mark ready for contributor review"}
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowOfflineForm((v) => !v)}
          className="rounded-md border border-black/15 px-3 py-1.5 text-sm font-medium dark:border-white/15"
        >
          Submit with offline confirmation
        </button>
      </div>
      {markReadyMessage && (
        <p role="status" className="text-sm text-black/70 dark:text-white/70">
          {markReadyMessage}
        </p>
      )}

      {showOfflineForm && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950">
          <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            Submit with offline confirmation
          </h2>
          <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
            Use this only when the contributor confirmed publication permission
            through a recorded channel OTHER than their own account (email, a
            written message, in person, or other) — this is the real, audited
            consent path, distinct from the evidence note below, which
            authorizes nothing.
          </p>
          <form action={offlineFormAction} className="mt-3 space-y-3">
            <input type="hidden" name="revisionId" value={revisionId} />
            <input type="hidden" name="expectedVersion" value={version} />
            <div>
              <label
                htmlFor="confirmation-method"
                className="block text-xs font-medium"
              >
                Confirmed via
              </label>
              <select
                id="confirmation-method"
                name="confirmationMethod"
                className="mt-1 rounded-md border border-black/15 px-2 py-1 text-sm dark:border-white/15 dark:bg-transparent"
              >
                <option value="email">Email</option>
                <option value="written_message">Written message</option>
                <option value="in_person">In person</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label
                htmlFor="identifiable-people"
                className="block text-xs font-medium"
              >
                Identifiable people in photos
              </label>
              <select
                id="identifiable-people"
                name="identifiablePeopleState"
                className="mt-1 rounded-md border border-black/15 px-2 py-1 text-sm dark:border-white/15 dark:bg-transparent"
              >
                <option value="not_applicable">
                  Not applicable (no photos, or none identifiable)
                </option>
                <option value="confirmed">
                  Confirmed — rights/permission obtained
                </option>
              </select>
            </div>
            <label className="flex items-center gap-1.5 text-xs">
              <input type="checkbox" name="imageRightsConfirmed" />
              Image rights confirmed (required if any images are attached)
            </label>
            <button
              type="submit"
              disabled={offlinePending}
              className="rounded-md bg-black px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60 dark:bg-white dark:text-black"
            >
              {offlinePending ? "Submitting…" : "Submit for moderation"}
            </button>
            {offlineState.error && (
              <p
                role="alert"
                className="text-sm text-red-700 dark:text-red-400"
              >
                {offlineState.error}
              </p>
            )}
            {offlineState.success && (
              <p
                role="status"
                className="text-sm text-green-800 dark:text-green-400"
              >
                {offlineState.success}
              </p>
            )}
          </form>
        </div>
      )}

      <details className="rounded-md border border-black/10 p-3 dark:border-white/10">
        <summary className="cursor-pointer text-sm font-medium">
          Log an evidence note (does not authorize publication)
        </summary>
        <form action={noteFormAction} className="mt-3 space-y-2">
          <input type="hidden" name="storyId" value={storyId} />
          <input type="hidden" name="revisionId" value={revisionId} />
          <textarea
            name="summary"
            rows={3}
            required
            placeholder="e.g. contributor confirmed by phone call on 2026-08-04, ref ticket #123"
            className="w-full rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/15 dark:bg-transparent"
          />
          <button
            type="submit"
            disabled={notePending}
            className="rounded-md border border-black/15 px-3 py-1.5 text-sm font-medium disabled:opacity-60 dark:border-white/15"
          >
            {notePending ? "Logging…" : "Log note"}
          </button>
          {noteState.error && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {noteState.error}
            </p>
          )}
          {noteState.success && (
            <p
              role="status"
              className="text-sm text-black/70 dark:text-white/70"
            >
              {noteState.success}
            </p>
          )}
        </form>
      </details>
    </div>
  );
}
