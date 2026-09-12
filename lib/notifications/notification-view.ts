import type { Database } from "@/types/database";

/**
 * One row of list_my_notifications(). Declared by hand rather than taken
 * from the generated type because `supabase gen types` marks every RETURNS
 * TABLE column non-null -- read_at is the one column here whose null is the
 * whole point (null = unread).
 */
export type NotificationRow = {
  id: string;
  kind: Database["public"]["Enums"]["notification_kind"];
  story_id: string;
  revision_id: string;
  story_title: string;
  story_slug: string;
  /** The moderator's user-facing reason -- only for story_rejected / story_changes_requested. */
  reason: string | null;
  read_at: string | null;
  created_at: string;
};

export type NotificationView = {
  id: string;
  href: string;
  /** Short lead line, e.g. "Story published". */
  heading: string;
  /** The story title, quoted by the renderer -- kept separate so it can be truncated on its own. */
  title: string;
  /** Moderator's reason, shown under the title when present. */
  reason: string | null;
  unread: boolean;
  createdAt: string;
};

/**
 * Turns an inbox row into what the bell renders. The DB deliberately stores
 * no route (see the 20260911100000 header): where a kind LEADS is an
 * application concern, and keeping it here means moving a page never needs
 * a data migration.
 *
 *   story_submitted -> the moderator's review page, keyed by revision id
 *                      (the same key /moderation/stories lists).
 *   story_published -> the public story page, by slug -- the thing the
 *                      contributor actually wants to see is their story,
 *                      live.
 *   story_rejected / story_changes_requested -> /my-stories, where the
 *                      story now sits with its "Not approved" / "Changes
 *                      requested" badge. The reason itself travels IN the
 *                      notification: no contributor page shows it (see
 *                      20260912100000), so this line is where they read it.
 *
 * Pure and `server-only`-free so the client bell and its tests can import
 * it directly.
 */
export function describeNotification(row: NotificationRow): NotificationView {
  const base = {
    id: row.id,
    title: row.story_title,
    reason: row.reason,
    unread: row.read_at === null,
    createdAt: row.created_at,
  };
  switch (row.kind) {
    case "story_submitted":
      return {
        ...base,
        heading: "New story to review",
        href: `/moderation/stories/${row.revision_id}`,
      };
    case "story_published":
      return {
        ...base,
        heading: "Your story is live",
        href: `/stories/${row.story_slug}`,
      };
    case "story_rejected":
      return {
        ...base,
        heading: "Your story wasn't approved",
        href: "/my-stories",
      };
    case "story_changes_requested":
      return {
        ...base,
        heading: "Changes requested on your story",
        href: "/my-stories",
      };
  }
}

/**
 * "just now" / "5m" / "3h" / "2d" / a short date. Relative for anything
 * under a week because that is when an inbox line is actually being
 * decided on; an absolute date past that, because "9d" makes the reader
 * do arithmetic to find out which day it was.
 */
export function formatNotificationAge(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(then).toLocaleDateString("en-NZ", {
    day: "numeric",
    month: "short",
  });
}

/** Badge text: exact up to 9, then "9+" so the pill never grows. */
export function formatUnreadBadge(count: number): string | null {
  if (count <= 0) return null;
  return count > 9 ? "9+" : String(count);
}
