import "server-only";

// Prompt 6 Stage 3: minimal structured operational logging for protected
// staff actions (approve/reject/archive/reassign/resolve-report). Grepped
// this codebase first (no console.error/logger convention exists anywhere
// outside test files) -- this is a new, deliberately small addition, not a
// replacement for the DB audit trail (moderation_actions/editorial_actions/
// story_publication_state_actions/story_reports.handled_by are still the
// source of truth for "what happened and why"; this is operational
// visibility only, e.g. for tailing production logs).
//
// Hard rule: never log story bodies, secrets, tokens, or private note
// contents -- only actor/action/target-id/outcome. Callers must not pass
// anything else in `detail` (kept short and non-sensitive, e.g. an error
// message with no user-authored free text).

export type StaffActionLogEntry = {
  /** The acting user's id (auth.uid()), never their email or profile data. */
  actor: string | null;
  /** A short, fixed action name, e.g. "moderation.approve". */
  action: string;
  /** The id of the row being acted on (revision/story/report id). */
  target: string;
  outcome: "success" | "error";
  /** Optional short, non-sensitive detail -- never a note/reason/body. */
  detail?: string;
};

export function logStaffAction(entry: StaffActionLogEntry): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    scope: "staff-action",
    ...entry,
  });
  if (entry.outcome === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

/**
 * Sibling of logStaffAction for operational events on paths that are NOT
 * staff-gated — added for the PDF import routes, where a best-effort step
 * failing part-way used to be swallowed by a bare `catch { break }` and left
 * no trace anywhere. Deliberately carries no actor: unlike a staff action,
 * these are not audit events and must not accumulate a per-user trail. The
 * DB audit tables remain the source of truth for "what happened and why";
 * this is operational visibility only.
 *
 * Same hard rule as above: never log story bodies, secrets, tokens, alt text,
 * captions, or any other user-authored free text -- only a fixed event name,
 * a row id, and short non-sensitive detail such as a count.
 */
export type AppEventLogEntry = {
  /** A short, fixed event name, e.g. "pdf-import.alt_text_partial". */
  event: string;
  /** The id of the row being acted on (story/revision id). */
  target: string;
  outcome: "success" | "error";
  /** Optional short, non-sensitive detail -- counts and codes, never content. */
  detail?: string;
};

export function logAppEvent(entry: AppEventLogEntry): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    scope: "app-event",
    ...entry,
  });
  if (entry.outcome === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}
