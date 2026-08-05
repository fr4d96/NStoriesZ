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
