"use client";

import { useActionState, useState } from "react";
import {
  reassignEditorialStoryAction,
  type ReassignActionState,
} from "./reassign-actions";

const initialState: ReassignActionState = {};

/**
 * Deliberately a raw target-editor-id field, not a picker -- no
 * moderator/editor "staff directory" listing function exists anywhere in
 * this codebase today (grepped), so there is no safe/authorized way to
 * populate a name-based dropdown. reassign_editorial_story() independently
 * verifies the target actually holds editor/admin via has_role() -- never
 * trusted from this form -- so a wrong/non-staff id here fails loudly
 * server-side rather than silently reassigning to nobody.
 */
export function ReassignForm({
  storyId,
  expectedVersion,
}: {
  storyId: string;
  expectedVersion: number;
}) {
  const [state, formAction, pending] = useActionState(
    reassignEditorialStoryAction,
    initialState,
  );
  const [open, setOpen] = useState(false);

  return (
    <div className="text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="underline underline-offset-2"
      >
        {open ? "Cancel" : "Reassign"}
      </button>
      {open && (
        <form action={formAction} className="mt-2 flex flex-col gap-1.5">
          <input type="hidden" name="storyId" value={storyId} />
          <input type="hidden" name="expectedVersion" value={expectedVersion} />
          <input
            type="text"
            name="editorId"
            placeholder="Target editor user ID (uuid)"
            required
            className="rounded-md border border-border-subtle px-2 py-1 dark:bg-transparent"
          />
          <input
            type="text"
            name="note"
            placeholder="Optional note"
            className="rounded-md border border-border-subtle px-2 py-1 dark:bg-transparent"
          />
          <button
            type="submit"
            disabled={pending}
            className="w-fit rounded-md border border-border-subtle px-2 py-1 font-medium disabled:opacity-60"
          >
            {pending ? "Reassigning…" : "Confirm reassignment"}
          </button>
          {state.error && (
            <p role="alert" className="text-destructive">
              {state.error}
            </p>
          )}
          {state.success && (
            <p role="status" className="text-muted-foreground">
              {state.success}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
