/**
 * Pure presentation derivations for the moderation stories queue and the
 * story review page.
 *
 * Kept out of the page components (and free of any `server-only` import) so
 * the labelling and the triage rules are unit-testable and can never drift
 * between the two surfaces: what the queue calls "No story content" is the
 * same predicate the review page uses to decide it should show an
 * empty-submission notice instead of "Could not render submitted content."
 *
 * Nothing here fetches or authorizes anything -- every input is a row the
 * caller already read through a moderator-scoped RPC.
 */

export const SUBMISSION_KIND_LABELS: Record<string, string> = {
  first: "First submission",
  replacement: "Replacement",
  resubmission: "Resubmission",
};

export const SOURCE_KIND_LABELS: Record<string, string> = {
  self_submitted: "Self-service",
  editorial_import: "Editorial import",
};

export const CONSENT_METHOD_LABELS: Record<string, string> = {
  account: "Account",
  email: "Email",
  written_message: "Written message",
  in_person: "In person",
  other: "Other",
};

/**
 * moderation_actions.new_status is a revision status, not a verb -- a
 * moderator reads "Rejected", not "rejected". Unknown values fall back to
 * the raw string rather than being hidden.
 */
export const DECISION_LABELS: Record<string, string> = {
  approved: "Approved",
  rejected: "Rejected",
  changes_requested: "Changes requested",
  withdrawn: "Withdrawn",
  submitted: "Re-opened",
};

export function labelFor(
  labels: Record<string, string>,
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  return labels[value] ?? value;
}

/** The one place "this submission is empty" is decided. */
export function isEmptySubmission(row: { content_text_length: number }) {
  return row.content_text_length === 0;
}

export type QueueSignalTone = "alert" | "warn" | "neutral";

export type QueueSignal = {
  /** Stable key -- React list key, and what the tests assert on. */
  id: string;
  label: string;
  tone: QueueSignalTone;
};

export type QueueSignalRow = {
  content_text_length: number;
  image_count: number;
  location_count: number;
  tag_count: number;
  open_report_count: number;
};

/**
 * The short chip row under a queue entry: everything that would otherwise
 * make a moderator open the story to find out.
 *
 * Ordering is deliberate and severity-first -- an empty submission and open
 * reports are decisions a moderator can make from the list itself, so they
 * lead; the "missing metadata" notes follow; the neutral photo count comes
 * last. Only problems and the photo count are emitted: a story that has
 * content, places and tags produces no "everything is fine" chips, so the
 * chips that DO appear always mean something.
 */
export function queueSignals(row: QueueSignalRow): QueueSignal[] {
  const signals: QueueSignal[] = [];

  if (isEmptySubmission(row)) {
    signals.push({
      id: "no-content",
      label: "No story content",
      tone: "alert",
    });
  }
  if (row.open_report_count > 0) {
    signals.push({
      id: "reports",
      label:
        row.open_report_count === 1
          ? "1 open report"
          : `${row.open_report_count} open reports`,
      tone: "alert",
    });
  }
  if (row.location_count === 0) {
    signals.push({ id: "no-place", label: "No place set", tone: "warn" });
  }
  if (row.tag_count === 0) {
    signals.push({ id: "no-tags", label: "No tags", tone: "warn" });
  }
  if (row.image_count > 0) {
    signals.push({
      id: "photos",
      label: row.image_count === 1 ? "1 photo" : `${row.image_count} photos`,
      tone: "neutral",
    });
  }

  return signals;
}

/**
 * Character count, not a word count. The stored document is Markdown and
 * carries `![[mediaId]]` embed tokens, so any word figure derived from it
 * in SQL would be quietly wrong; characters is what
 * _content_json_text_length() actually measures, so that is what this says.
 */
export function contentLengthLabel(characters: number): string {
  if (characters === 0) return "Empty";
  return `${characters.toLocaleString("en-NZ")} characters`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "Just now" / "14 min ago" / "3 h ago" / "5 days ago" / "6 Aug".
 *
 * Deliberately NOT Intl.RelativeTimeFormat: this renders inside a Server
 * Component, so the string is produced on the server and must not depend on
 * a locale-dependent word order that could differ from the absolute
 * timestamp rendered beside it. Anything older than a week reads as a plain
 * date -- "43 days ago" is not a unit anyone triages in.
 *
 * `now` is injectable so the tests are not clock-dependent.
 */
export function relativeTime(
  iso: string | null,
  now: Date = new Date(),
): string | null {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;

  const elapsed = now.getTime() - then.getTime();
  // A clock skew between the database and this process can make a
  // just-written row read as the future; show it as "just now" rather than
  // "in -0 minutes".
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) {
    const minutes = Math.floor(elapsed / MINUTE);
    return `${minutes} min ago`;
  }
  if (elapsed < DAY) {
    const hours = Math.floor(elapsed / HOUR);
    return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  }
  const days = Math.floor(elapsed / DAY);
  if (days <= 7) return days === 1 ? "1 day ago" : `${days} days ago`;

  return then.toLocaleDateString("en-NZ", {
    day: "numeric",
    month: "short",
    year: then.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

/** Full timestamp for the `title=`/secondary line beside relativeTime(). */
export function absoluteTime(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("en-NZ", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * "Fred" for a self-service story, "Fred (via editorial import)" for one an
 * editor prepared -- the queue's single most-missed field was "who is this
 * from", and for an import the honest answer names both the contributor and
 * the fact that staff prepared it.
 */
export function submitterLabel(row: {
  contributor_display_name: string | null;
  source_kind: string | null;
}): string {
  const name = row.contributor_display_name?.trim();
  if (!name) return "Unknown contributor";
  if (row.source_kind === "editorial_import") {
    return `${name} (via editorial import)`;
  }
  return name;
}
