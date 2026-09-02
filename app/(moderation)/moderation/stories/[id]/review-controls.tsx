"use client";

import { useActionState, useState } from "react";
import { AlertCircleIcon } from "@/components/icons";
import {
  approveStoryAction,
  moderateDecisionAction,
  archiveStoryAction,
  type ModerationActionState,
} from "./actions";

const initialState: ModerationActionState = {};

const TEXTAREA_CLASSES =
  "w-full rounded-md border border-border-subtle bg-surface-muted px-3 py-2 text-sm text-foreground transition-colors duration-150 hover:border-foreground/30 focus:border-accent focus:outline-none";

const FIELD_LABEL_CLASSES =
  "font-mono text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground";

/**
 * Pre-filled into the "reason shown to the contributor" box when the
 * submission has nothing to read. It is a starting point, not a decision --
 * the moderator can edit or clear it, and nothing is sent until they press
 * the button. Kept short and specific for the same reason every other
 * user-facing string in this app is: the contributor reads it verbatim.
 */
const EMPTY_CONTENT_REASON =
  "This came through without any story text — only a title. Add the story itself and submit again and we'll take another look.";

export function ReviewControls({
  revisionId,
  storyId,
  storyVersion,
  revisionStatus,
  contentIsEmpty = false,
}: {
  revisionId: string;
  storyId: string;
  storyVersion: number;
  revisionStatus: string;
  /**
   * True when the page decided there is nothing readable to publish (an
   * empty document, or one that could not be parsed). It never DISABLES
   * approve -- a moderator may know something this page does not, and
   * silently removing the control would be worse than warning about it --
   * it only warns, and pre-fills the request-changes reason.
   */
  contentIsEmpty?: boolean;
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
    <section
      aria-label="Decision"
      className="mt-8 space-y-5 border-t border-border-subtle pt-6"
    >
      <h2 className="text-lg font-semibold tracking-tight">Decision</h2>

      {decisionMessage && (
        <p
          role={decisionMessageIsError ? "alert" : "status"}
          className={
            decisionMessageIsError
              ? "text-sm font-semibold text-destructive"
              : "text-sm font-semibold text-accent"
          }
        >
          {decisionMessage}
        </p>
      )}

      {canDecide ? (
        <>
          {/*
            Request changes comes FIRST when there is nothing to publish.
            Reading order is the recommendation: the most likely correct
            action for this submission sits at the top of the column.
          */}
          <div
            className={`space-y-5 ${contentIsEmpty ? "flex flex-col-reverse space-y-reverse" : ""}`}
          >
            <div className="rounded-xl border border-border-subtle p-4 sm:p-5">
              <h3 className="text-sm font-semibold">Approve and publish</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Begins a publication attempt, copies any not-yet-promoted media
                to public storage, then finalizes publication. If any step
                fails, nothing is silently lost — the attempt stays active and
                can be retried.
              </p>
              {contentIsEmpty && (
                <p className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/[0.06] px-3 py-2 text-xs font-semibold text-destructive">
                  <AlertCircleIcon
                    aria-hidden="true"
                    className="mt-px h-3.5 w-3.5 shrink-0"
                  />
                  There is nothing readable to publish here. Approving would put
                  an empty story live.
                </p>
              )}
              <form action={approveFormAction} className="mt-3 space-y-2">
                <input type="hidden" name="revisionId" value={revisionId} />
                <input type="hidden" name="storyId" value={storyId} />
                <label className="block">
                  <span className={FIELD_LABEL_CLASSES}>
                    Note to the contributor (optional)
                  </span>
                  <textarea
                    name="userFacingReason"
                    rows={2}
                    placeholder="Optional note shown to the contributor"
                    className={`mt-1 ${TEXTAREA_CLASSES}`}
                  />
                </label>
                <label className="block">
                  <span className={FIELD_LABEL_CLASSES}>
                    Internal note (optional, staff only)
                  </span>
                  <textarea
                    name="editorNote"
                    rows={2}
                    placeholder="Optional internal note (staff only)"
                    className={`mt-1 ${TEXTAREA_CLASSES}`}
                  />
                </label>
                <button
                  type="submit"
                  disabled={approvePending}
                  className="rounded-full bg-accent px-5 py-2.5 text-sm font-bold text-accent-foreground transition-opacity duration-150 hover:opacity-90 disabled:opacity-60"
                >
                  {approvePending ? "Approving…" : "Approve and publish"}
                </button>
              </form>
            </div>

            <div
              className={`rounded-xl border p-4 sm:p-5 ${contentIsEmpty ? "border-accent/50" : "border-border-subtle"}`}
            >
              <h3 className="text-sm font-semibold">
                Reject / request changes
              </h3>
              {contentIsEmpty && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Suggested for this submission — a reason is pre-filled below
                  and you can edit it before sending.
                </p>
              )}
              <form action={decisionFormAction} className="mt-3 space-y-2">
                <input type="hidden" name="revisionId" value={revisionId} />
                <input
                  type="hidden"
                  name="expectedVersion"
                  value={storyVersion}
                />
                <label className="block">
                  <span className={FIELD_LABEL_CLASSES}>Decision</span>
                  <select
                    name="decision"
                    className="mt-1 block rounded-md border border-border-subtle bg-surface-muted px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none"
                  >
                    <option value="changes_requested">Request changes</option>
                    <option value="reject">Reject</option>
                  </select>
                </label>
                <label className="block">
                  <span className={FIELD_LABEL_CLASSES}>
                    Reason shown to the contributor (required)
                  </span>
                  <textarea
                    name="userFacingReason"
                    rows={3}
                    required
                    defaultValue={contentIsEmpty ? EMPTY_CONTENT_REASON : ""}
                    placeholder="Reason shown to the contributor (required)"
                    className={`mt-1 ${TEXTAREA_CLASSES}`}
                  />
                </label>
                <label className="block">
                  <span className={FIELD_LABEL_CLASSES}>
                    Internal note (optional, staff only)
                  </span>
                  <textarea
                    name="editorNote"
                    rows={2}
                    placeholder="Optional internal note (staff only)"
                    className={`mt-1 ${TEXTAREA_CLASSES}`}
                  />
                </label>
                <button
                  type="submit"
                  disabled={decisionPending}
                  className="rounded-full border border-foreground/30 px-5 py-2.5 text-sm font-bold transition-colors duration-150 hover:border-foreground disabled:opacity-60"
                >
                  {decisionPending ? "Submitting…" : "Submit decision"}
                </button>
              </form>
            </div>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          This revision is currently &ldquo;{revisionStatus}&rdquo; — approve /
          reject / request-changes only apply to a submitted revision.
        </p>
      )}

      <div className="rounded-xl border border-border-subtle p-4 sm:p-5">
        <button
          type="button"
          onClick={() => setShowArchive((v) => !v)}
          aria-expanded={showArchive}
          className="text-sm font-semibold text-destructive underline underline-offset-4"
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
            <label className="block">
              <span className={FIELD_LABEL_CLASSES}>Reason (required)</span>
              <textarea
                name="reason"
                rows={2}
                required
                placeholder="Reason (required)"
                className={`mt-1 ${TEXTAREA_CLASSES}`}
              />
            </label>
            <label className="block">
              <span className={FIELD_LABEL_CLASSES}>
                Internal note (optional)
              </span>
              <textarea
                name="note"
                rows={2}
                placeholder="Optional internal note"
                className={`mt-1 ${TEXTAREA_CLASSES}`}
              />
            </label>
            <button
              type="submit"
              disabled={archivePending}
              className="rounded-full bg-destructive px-5 py-2.5 text-sm font-bold text-white transition-opacity duration-150 hover:opacity-90 disabled:opacity-60"
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
      </div>
    </section>
  );
}
