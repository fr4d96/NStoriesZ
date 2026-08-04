"use client";

import { useActionState, useState } from "react";
import { SubmitConsentPanel } from "@/components/story/submit-consent-panel";
import {
  requestEditorialChangesAction,
  declineEditorialPublicationAction,
  type ConsentActionState,
} from "@/app/(contributor)/stories/[id]/preview/actions";

const initialState: ConsentActionState = {};

export type ContributorReviewPanelProps = {
  storyId: string;
  revisionId: string;
  expectedVersion: number;
  hasMedia: boolean;
};

/**
 * Shown only when the current viewer is the linked contributor AND the
 * story is awaiting THEIR approval of an editor-prepared draft
 * (viewerRelationship === 'linked_contributor' && lifecycleStatus ===
 * 'awaiting_contributor_approval') -- see app/(contributor)/stories/[id]/preview/page.tsx.
 * "Approve" reuses the same consent-at-submission panel every first
 * submission uses (submit_revision_with_consent() itself accepts this exact
 * case as of Prompt 4 Sub-phase 4's awaiting-approval fix); "request
 * changes"/"decline" call the two existing, previously UI-less RPCs.
 */
export function ContributorReviewPanel({
  storyId,
  revisionId,
  expectedVersion,
  hasMedia,
}: ContributorReviewPanelProps) {
  const [mode, setMode] = useState<"approve" | "changes" | "decline" | null>(
    null,
  );
  const [changesState, changesFormAction, changesPending] = useActionState(
    requestEditorialChangesAction,
    initialState,
  );
  const [declineState, declineFormAction, declinePending] = useActionState(
    declineEditorialPublicationAction,
    initialState,
  );

  return (
    <div className="rounded-md border border-blue-300 bg-blue-50 p-4 dark:border-blue-700 dark:bg-blue-950">
      <h2 className="text-sm font-semibold text-blue-900 dark:text-blue-200">
        An editor prepared this story for you
      </h2>
      <p className="mt-1 text-xs text-blue-800 dark:text-blue-300">
        Review it above, then approve it for moderation, ask for changes, or
        decline publication entirely.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setMode(mode === "approve" ? null : "approve")}
          className="rounded-md bg-black px-3 py-1.5 text-sm font-semibold text-white dark:bg-white dark:text-black"
        >
          Approve
        </button>
        <button
          type="button"
          onClick={() => setMode(mode === "changes" ? null : "changes")}
          className="rounded-md border border-black/15 px-3 py-1.5 text-sm font-medium dark:border-white/15"
        >
          Request changes
        </button>
        <button
          type="button"
          onClick={() => setMode(mode === "decline" ? null : "decline")}
          className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 dark:border-red-700 dark:text-red-400"
        >
          Decline
        </button>
      </div>

      {mode === "approve" && (
        <div className="mt-4">
          <SubmitConsentPanel
            storyId={storyId}
            revisionId={revisionId}
            expectedVersion={expectedVersion}
            hasMedia={hasMedia}
            isEditorialImport
            submitLabel="Approve & submit for moderation"
          />
        </div>
      )}

      {mode === "changes" && (
        <form action={changesFormAction} className="mt-4 space-y-2">
          <input type="hidden" name="storyId" value={storyId} />
          <textarea
            name="note"
            required
            rows={3}
            placeholder="What would you like changed?"
            className="w-full rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/15 dark:bg-transparent"
          />
          <button
            type="submit"
            disabled={changesPending}
            className="rounded-md border border-black/15 px-3 py-1.5 text-sm font-medium disabled:opacity-60 dark:border-white/15"
          >
            {changesPending ? "Sending…" : "Send request"}
          </button>
          {changesState.error && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {changesState.error}
            </p>
          )}
        </form>
      )}

      {mode === "decline" && (
        <form action={declineFormAction} className="mt-4 space-y-2">
          <input type="hidden" name="storyId" value={storyId} />
          <textarea
            name="note"
            rows={3}
            placeholder="Optional: let the editor know why."
            className="w-full rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/15 dark:bg-transparent"
          />
          <button
            type="submit"
            disabled={declinePending}
            className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 disabled:opacity-60 dark:border-red-700 dark:text-red-400"
          >
            {declinePending ? "Declining…" : "Confirm decline"}
          </button>
          {declineState.error && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {declineState.error}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
