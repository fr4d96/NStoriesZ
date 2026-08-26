/**
 * Pure derivations behind the /moderation overview's analytics.
 *
 * Deliberately I/O-free and free of `server-only`: every number on the
 * dashboard is computed here from rows the existing moderator RPCs already
 * return (get_moderation_queue, list_reports_for_staff,
 * get_operational_metrics), so the dashboard adds NO new database surface,
 * no new grants, and nothing that could widen what a moderator can read.
 * The page is the only caller; these functions are what the unit tests
 * exercise.
 *
 * Both RPCs clamp p_limit to 50, so anything derived from a *sample* of
 * rows carries a sampled flag the UI has to disclose rather than quietly
 * presenting a partial count as a total.
 */

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

/** Waiting longer than this is called out as overdue. */
export const QUEUE_OVERDUE_HOURS = 168; // 7 days

export type QueueAgeBucketKey =
  "under_24h" | "one_to_three_days" | "three_to_seven_days" | "over_seven_days";

export type QueueAgeBucket = {
  key: QueueAgeBucketKey;
  label: string;
  /** Axis-scale label for the legend/table, in the mono "record" voice. */
  shortLabel: string;
  count: number;
  /** 1-4, the severity step used to pick a --chart-N token. */
  step: 1 | 2 | 3 | 4;
};

const AGE_BUCKETS: {
  key: QueueAgeBucketKey;
  label: string;
  shortLabel: string;
  step: 1 | 2 | 3 | 4;
  maxHours: number;
}[] = [
  {
    key: "under_24h",
    label: "Under 24 hours",
    shortLabel: "<24h",
    step: 1,
    maxHours: 24,
  },
  {
    key: "one_to_three_days",
    label: "1 to 3 days",
    shortLabel: "1-3d",
    step: 2,
    maxHours: 72,
  },
  {
    key: "three_to_seven_days",
    label: "3 to 7 days",
    shortLabel: "3-7d",
    step: 3,
    maxHours: QUEUE_OVERDUE_HOURS,
  },
  {
    key: "over_seven_days",
    label: "Over 7 days",
    shortLabel: "7d+",
    step: 4,
    maxHours: Number.POSITIVE_INFINITY,
  },
];

type SubmittedRow = { submitted_at: string | null };

/**
 * Hours a row has been waiting. A row with no submitted_at is not dated
 * (the queue can carry one for a revision whose timestamp was never set) --
 * it is excluded from every age statistic rather than counted as zero,
 * which would silently understate the wait.
 */
export function waitingHours(row: SubmittedRow, now: Date): number | null {
  if (!row.submitted_at) return null;
  const submitted = new Date(row.submitted_at).getTime();
  if (Number.isNaN(submitted)) return null;
  return Math.max(0, (now.getTime() - submitted) / HOUR_MS);
}

export function bucketQueueAges(
  rows: SubmittedRow[],
  now: Date,
): QueueAgeBucket[] {
  const counts = new Map<QueueAgeBucketKey, number>(
    AGE_BUCKETS.map((b) => [b.key, 0]),
  );

  for (const row of rows) {
    const hours = waitingHours(row, now);
    if (hours === null) continue;
    const bucket =
      AGE_BUCKETS.find((b) => hours < b.maxHours) ??
      AGE_BUCKETS[AGE_BUCKETS.length - 1];
    counts.set(bucket.key, (counts.get(bucket.key) ?? 0) + 1);
  }

  return AGE_BUCKETS.map((b) => ({
    key: b.key,
    label: b.label,
    shortLabel: b.shortLabel,
    step: b.step,
    count: counts.get(b.key) ?? 0,
  }));
}

export function oldestWaitingHours(
  rows: SubmittedRow[],
  now: Date,
): number | null {
  let oldest: number | null = null;
  for (const row of rows) {
    const hours = waitingHours(row, now);
    if (hours === null) continue;
    if (oldest === null || hours > oldest) oldest = hours;
  }
  return oldest;
}

/** Longest-waiting first; undated rows sort last (they carry no wait). */
export function sortByLongestWaiting<T extends SubmittedRow>(
  rows: T[],
  now: Date,
): T[] {
  return [...rows].sort((a, b) => {
    const ha = waitingHours(a, now);
    const hb = waitingHours(b, now);
    if (ha === null && hb === null) return 0;
    if (ha === null) return 1;
    if (hb === null) return -1;
    return hb - ha;
  });
}

export type CountedSlice = {
  key: string;
  label: string;
  count: number;
};

const SUBMISSION_KIND_LABELS: Record<string, string> = {
  first: "First submission",
  replacement: "Replacement",
  resubmission: "Resubmission",
};

export function summarizeSubmissionKinds(
  rows: { submission_kind: string }[],
): CountedSlice[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.submission_kind, (counts.get(row.submission_kind) ?? 0) + 1);
  }
  // Fixed order -- a slice's position never depends on its rank, so the
  // shape stays comparable between two loads of the page.
  return ["first", "replacement", "resubmission"]
    .map((key) => ({
      key,
      label: SUBMISSION_KIND_LABELS[key] ?? key,
      count: counts.get(key) ?? 0,
    }))
    .filter((slice) => slice.count > 0);
}

export const REPORT_CATEGORY_LABELS: Record<string, string> = {
  misinformation: "Misinformation",
  unsafe_employment_advice: "Unsafe employment advice",
  harassment: "Harassment",
  copyright_privacy: "Copyright / privacy",
  spam_commercial: "Spam or commercial",
  other: "Other",
};

export const REPORT_STATUS_LABELS: Record<string, string> = {
  open: "Open",
  reviewing: "Reviewing",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

type ReportRow = { category: string; status: string; created_at: string };

/** Descending by count -- a ranked list, not a color-carrying series. */
export function summarizeReportCategories(rows: ReportRow[]): CountedSlice[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.category, (counts.get(row.category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({
      key,
      label: REPORT_CATEGORY_LABELS[key] ?? key,
      count,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function summarizeReportStatuses(rows: ReportRow[]): CountedSlice[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
  }
  return ["open", "reviewing", "resolved", "dismissed"]
    .map((key) => ({
      key,
      label: REPORT_STATUS_LABELS[key] ?? key,
      count: counts.get(key) ?? 0,
    }))
    .filter((slice) => slice.count > 0);
}

export type TrendPoint = {
  /** UTC calendar day, YYYY-MM-DD. */
  date: string;
  count: number;
};

function utcDayKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * Reports per UTC day over the trailing `days` window, ending today.
 * Empty days are present with a count of 0 -- a trend with holes in it
 * reads as a gap in reporting rather than a quiet day.
 */
export function buildReportTrend(
  rows: { created_at: string }[],
  now: Date,
  days = 14,
): TrendPoint[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const created = new Date(row.created_at);
    if (Number.isNaN(created.getTime())) continue;
    const key = utcDayKey(created);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const points: TrendPoint[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = new Date(now.getTime() - i * DAY_MS);
    const key = utcDayKey(day);
    points.push({ date: key, count: counts.get(key) ?? 0 });
  }
  return points;
}

/** "4h" / "2d 3h" / "9d" -- a wait, not a timestamp. */
export function formatWait(hours: number): string {
  if (hours < 1) return "<1h";
  if (hours < 24) return `${Math.floor(hours)}h`;
  const days = Math.floor(hours / 24);
  const remainder = Math.floor(hours % 24);
  if (days >= 7 || remainder === 0) return `${days}d`;
  return `${days}d ${remainder}h`;
}

export function sumCounts(slices: { count: number }[]): number {
  return slices.reduce((total, slice) => total + slice.count, 0);
}

/**
 * Story ids this viewer may open in the editorial editor.
 *
 * /editorial/:id/edit authorizes only the story's contributor or its
 * ASSIGNED editor (supabase/migrations/20260804092000_assigned_editor_can_read_draft.sql),
 * so being editor-or-admin is NOT sufficient -- an admin who is not
 * personally assigned gets the same flat 404 a moderator does. Kept here
 * with the other pure derivations so /readiness can decide whether to
 * render an "Open in editorial" link without guessing.
 */
export function selectStoriesAssignedTo(
  entries: { story_id: string; assigned_editor_id: string | null }[],
  userId: string,
): Set<string> {
  return new Set(
    entries
      .filter((entry) => entry.assigned_editor_id === userId)
      .map((entry) => entry.story_id),
  );
}
