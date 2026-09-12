import { describe, expect, it } from "vitest";
import {
  describeNotification,
  formatNotificationAge,
  formatUnreadBadge,
  type NotificationRow,
} from "./notification-view";

const base: NotificationRow = {
  id: "n1",
  kind: "story_submitted",
  story_id: "s1",
  revision_id: "r1",
  story_title: "Picking kiwifruit in Te Puke",
  story_slug: "picking-kiwifruit-abc123",
  read_at: null,
  created_at: "2026-09-11T10:00:00Z",
};

describe("describeNotification", () => {
  it("sends a moderator to the review page keyed by revision id", () => {
    const view = describeNotification(base);
    expect(view.href).toBe("/moderation/stories/r1");
    expect(view.heading).toBe("New story to review");
    expect(view.title).toBe("Picking kiwifruit in Te Puke");
    expect(view.unread).toBe(true);
  });

  it("sends a contributor to their live story by slug", () => {
    const view = describeNotification({
      ...base,
      kind: "story_published",
      read_at: "2026-09-11T11:00:00Z",
    });
    expect(view.href).toBe("/stories/picking-kiwifruit-abc123");
    expect(view.heading).toBe("Your story is live");
    expect(view.unread).toBe(false);
  });
});

describe("formatNotificationAge", () => {
  const now = Date.parse("2026-09-11T12:00:00Z");
  it.each([
    ["2026-09-11T11:59:30Z", "just now"],
    ["2026-09-11T11:55:00Z", "5m"],
    ["2026-09-11T09:00:00Z", "3h"],
    ["2026-09-09T12:00:00Z", "2d"],
  ])("%s -> %s", (iso, expected) => {
    expect(formatNotificationAge(iso, now)).toBe(expected);
  });

  it("switches to a short date after a week", () => {
    // Day-of-month is left loose on purpose: toLocaleDateString renders in
    // the machine's own zone, and noon UTC on the 30th is already the 31st
    // in New Zealand.
    const out = formatNotificationAge("2026-08-30T12:00:00Z", now);
    expect(out).toMatch(/^3[01] Aug$/);
  });

  it("never shows a negative age for a clock slightly ahead of the server", () => {
    expect(formatNotificationAge("2026-09-11T12:00:20Z", now)).toBe("just now");
  });

  it("returns an empty string for an unparseable timestamp", () => {
    expect(formatNotificationAge("not a date", now)).toBe("");
  });
});

describe("formatUnreadBadge", () => {
  it("hides at zero, is exact to nine, then caps", () => {
    expect(formatUnreadBadge(0)).toBeNull();
    expect(formatUnreadBadge(1)).toBe("1");
    expect(formatUnreadBadge(9)).toBe("9");
    expect(formatUnreadBadge(10)).toBe("9+");
    expect(formatUnreadBadge(250)).toBe("9+");
  });
});
