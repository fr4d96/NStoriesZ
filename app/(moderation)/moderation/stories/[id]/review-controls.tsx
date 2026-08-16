"use client";

import { useActionState, useState } from "react";
import {
  approveStoryAction,
  moderateDecisionAction,
  archiveStoryAction,
  type ModerationActionState,
} from "./actions";

const initialState: ModerationActionState = {};

export function ReviewControls({
  revisionId,
  storyId,
  storyVersion,
  revisionStatus,
}: {
  revisionId: string;
  storyId: string;
  storyVersion: number;
  revisionStatus: string;
}) {
  const [approveState, approveFormAction, approvePending] = useActionState(
    approveStoryAction,
    initialState,
  );
  const [decisionState, decisionFormAction, decisionPending] = useActionState(
    moderateDecisionAction,
    initialState,
  );
  const [archiveState, archiveFormAction, archivePending] = useActionState(
    archiveStoryAction,
    initialState,
  );
  const [showArchive, setShowArchive] = useState(false);

  const canDecide = revisionStatus === "submitted";

  // Stage 3 hardening fix: a successful approve/reject/changes-requested
  // action calls revalidatePath(), which re-fetches this page's Server
  // Component data in the SAME transition the action's own returned state
  // (approveState.success etc.) becomes visible in. That refetch changes
  // `revisionStatus` (submitted -> approved/rejected/changes_requested), so
  // `canDecide` immediately goes false -- and since the success/error
  // messages used to live INSIDE the `canDecide` branch, the confirmation
  // a moderator just triggered was replaced by the "not submitted anymore"
  // fallback text before it could ever be seen (caught live via
  // e2e/moderation.spec.ts: the approve/reject specs timed out waiting for
  // role="status"). Fixed by rendering any pending success/error message
  // for either action UNCONDITIONALLY, above the canDecide branch, so it
  // survives the moment the surrounding form/section disappears.
  // Note: with two independent forms/action states and no ordering signal
  // between them, this prioritizes approve's message over decision's if a
  // moderator somehow triggers both without a reload in between (rare in
  // practice -- the "not submitted anymore" fallback also appears the
  // moment either one succeeds, telling them a decision was already made).
  const decisionMessage =
    approveState.success ??
    approveState.error ??
    decisionState.success ??
    decisionState.error ??
    null;
  const decisionMessageIsError = Boolean(
    approveState.error || decisionState.error,
  );

  return (
    <div className="mt-8 space-y-6 border-t border-border-subtle pt-6">
      {decisionMessage && (
        <p
          role={decisionMessageIsError ? "alert" : "status"}
          className={
            decisionMessageIsError
              ? "text-sm text-destructive"
              : "text-sm text-green-800 dark:text-green-400"
          }
        >
          {decisionMessage}
        </p>
      )}
      {canDecide ? (
        <>
          <section className="rounded-md border border-green-300 p-4 dark:border-green-700">
            <h2 className="text-sm font-semibold text-green-800 dark:text-green-300">
              Approve
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Begins a publication attempt, copies any not-yet-promoted media to
              public storage, then finalizes publication. If any step fails,
              nothing is silently lost — the attempt stays active and can be
              retried.
            </p>
            <form action={approveFormAction} className="mt-3 space-y-2">
              <input type="hidden" name="revisionId" value={revisionId} />
              <input type="hidden" name="storyId" value={storyId} />
              <textarea
                name="userFacingReason"
                rows={2}
                placeholder="Optional note shown to the contributor"
                className="w-full rounded-md border border-border-subtle px-3 py-2 text-sm dark:bg-transparent"
              />
              <textarea
                name="editorNote"
                rows={2}
                placeholder="Optional internal note (staff only)"
                className="w-full rounded-md border border-border-subtle px-3 py-2 text-sm dark:bg-transparent"
              />
              <button
                type="submit"
                disabled={approvePending}
                className="rounded-md bg-green-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
              >
                {approvePending ? "Approving…" : "Approve and publish"}
              </button>
            </form>
          </section>

          <section className="rounded-md border border-amber-300 p-4 dark:border-amber-700">
            <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              Reject / request changes
            </h2>
            <form action={decisionFormAction} className="mt-3 space-y-2">
              <input type="hidden" name="revisionId" value={revisionId} />
              <input
                type="hidden"
                name="expectedVersion"
                value={storyVersion}
              />
              <label className="block text-xs font-medium">
                Decision
                <select
                  name="decision"
                  className="mt-1 block rounded-md border border-border-subtle px-2 py-1 text-sm dark:bg-transparent"
                >
                  <option value="changes_requested">Request changes</option>
                  <option value="reject">Reject</option>
                </select>
              </label>
              <textarea
                name="userFacingReason"
                rows={2}
                required
                placeholder="Reason shown to the contributor (required)"
                className="w-full rounded-md border border-border-subtle px-3 py-2 text-sm dark:bg-transparent"
              />
              <textarea
                name="editorNote"
                rows={2}
                placeholder="Optional internal note (staff only)"
                className="w-full rounded-md border border-border-subtle px-3 py-2 text-sm dark:bg-transparent"
              />
              <button
                type="submit"
                disabled={decisionPending}
                className="rounded-md border border-amber-500 px-3 py-1.5 text-sm font-semibold text-amber-900 disabled:opacity-60 dark:text-amber-200"
              >
                {decisionPending ? "Submitting…" : "Submit decision"}
              </button>
            </form>
          </section>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          This revision is currently &ldquo;{revisionStatus}&rdquo; — approve /
          reject / request-changes only apply to a submitted revision.
        </p>
      )}

      <section className="rounded-md border border-red-300 p-4 dark:border-red-700">
        <button
          type="button"
          onClick={() => setShowArchive((v) => !v)}
          className="text-sm font-semibold text-destructive"
        >
          {showArchive
            ? "Hide archive/unpublish"
            : "Archive / unpublish this story"}
        </button>
        {showArchive && (
          <form action={archiveFormAction} className="mt-3 space-y-2">
            <input type="hidden" name="storyId" value={storyId} />
            <input type="hidden" name="revisionId" value={revisionId} />
            <input type="hidden" name="expectedVersion" value={storyVersion} />
            <textarea
              name="reason"
              rows={2}
              required
              placeholder="Reason (required)"
              className="w-full rounded-md border border-border-subtle px-3 py-2 text-sm dark:bg-transparent"
            />
            <textarea
              name="note"
              rows={2}
              placeholder="Optional internal note"
              className="w-full rounded-md border border-border-subtle px-3 py-2 text-sm dark:bg-transparent"
            />
            <button
              type="submit"
              disabled={archivePending}
              className="rounded-md bg-red-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {archivePending ? "Archiving…" : "Archive story"}
            </button>
            {archiveState.error && (
              <p role="alert" className="text-sm text-destructive">
                {archiveState.error}
              </p>
            )}
            {archiveState.success && (
              <p role="status" className="text-sm text-muted-foreground">
                {archiveState.success}
              </p>
            )}
          </form>
        )}
      </section>
    </div>
  );
}
