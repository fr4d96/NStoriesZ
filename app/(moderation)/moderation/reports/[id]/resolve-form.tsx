"use client";

import { useActionState, useState } from "react";
import { reportNoteRequired } from "@/lib/validation/moderation";
import { resolveReportAction, type ResolveReportActionState } from "./actions";

const initialState: ResolveReportActionState = {};

/**
 * Status transition + internal-note form. The note becomes required
 * (client-side only, via reportNoteRequired() -- resolve_report() itself
 * is the real, non-bypassable enforcement per Engineering Rule 3) whenever
 * the selected target status is resolved/dismissed AND the report's own
 * category is one of the four serious ones. Never disabled/hidden for
 * reviewing, since that transition never requires a note regardless of
 * category.
 */
export function ResolveReportForm({
  reportId,
  category,
  currentStatus,
}: {
  reportId: string;
  category: string;
  currentStatus: string;
}) {
  const [state, formAction, pending] = useActionState(
    resolveReportAction,
    initialState,
  );
  const [status, setStatus] = useState<"reviewing" | "resolved" | "dismissed">(
    currentStatus === "open" || currentStatus === "reviewing"
      ? "reviewing"
      : "resolved",
  );

  const noteRequired = reportNoteRequired(category, status);
  const alreadyClosed =
    currentStatus === "resolved" || currentStatus === "dismissed";

  // Stage 3 hardening fix (found live, same root cause as
  // app/(moderation)/moderation/stories/[id]/review-controls.tsx's own fix):
  // a successful resolve action calls revalidatePath(), which re-fetches
  // this page's Server Component data in the same transition the action's
  // own returned success/error state becomes visible in. That refetch
  // changes `currentStatus` to resolved/dismissed, so `alreadyClosed`
  // immediately becomes true -- and since this early-return used to replace
  // the ENTIRE form (including the success/error message) with the
  // "already closed" fallback, the confirmation a moderator just triggered
  // was never actually observable. Rendered unconditionally, above the
  // alreadyClosed early return, so it survives that moment.
  const message = state.success ?? state.error ?? null;

  if (alreadyClosed) {
    return (
      <>
        {message && (
          <p
            role={state.error ? "alert" : "status"}
            className={
              state.error
                ? "text-sm text-destructive"
                : "text-sm text-green-800 dark:text-green-400"
            }
          >
            {message}
          </p>
        )}
        <p className="mt-2 text-sm text-muted-foreground">
          This report is already {currentStatus} and cannot be reopened --
          resolve_report() rejects any further transition once closed.
        </p>
      </>
    );
  }

  return (
    <form action={formAction} className="mt-3 space-y-3">
      <input type="hidden" name="reportId" value={reportId} />
      <label className="block text-xs font-medium">
        Status
        <select
          name="status"
          value={status}
          onChange={(e) =>
            setStatus(e.target.value as "reviewing" | "resolved" | "dismissed")
          }
          className="mt-1 block rounded-md border border-border-subtle px-2 py-1 text-sm dark:bg-transparent"
        >
          <option value="reviewing">Mark as reviewing</option>
          <option value="resolved">Resolve</option>
          <option value="dismissed">Dismiss</option>
        </select>
      </label>
      <label className="block text-xs font-medium">
        Internal note (staff only -- never shown to the reporter)
        <textarea
          name="internalNote"
          rows={3}
          required={noteRequired}
          placeholder={
            noteRequired
              ? "Required for this category when closing a report (e.g. what was verified, what action was taken)."
              : "Optional"
          }
          className="mt-1 w-full rounded-md border border-border-subtle px-3 py-2 text-sm dark:bg-transparent"
        />
        {noteRequired && (
          <span className="mt-1 block text-xs text-amber-700 dark:text-amber-400">
            A note is required to {status} a report in this category.
          </span>
        )}
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-accent-foreground disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save"}
      </button>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state.success && (
        <p role="status" className="text-sm text-green-800 dark:text-green-400">
          {state.success}
        </p>
      )}
    </form>
  );
}
