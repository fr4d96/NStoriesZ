import { describe, expect, it } from "vitest";
import {
  DAY_MS,
  HOUR_MS,
  bucketQueueAges,
  buildReportTrend,
  formatWait,
  oldestWaitingHours,
  selectStoriesAssignedTo,
  sortByLongestWaiting,
  summarizeReportCategories,
  summarizeReportStatuses,
  summarizeSubmissionKinds,
  waitingHours,
} from "./moderation-analytics";

const NOW = new Date("2026-08-22T12:00:00.000Z");

function agoHours(hours: number): string {
  return new Date(NOW.getTime() - hours * HOUR_MS).toISOString();
}

describe("waitingHours", () => {
  it("returns null for a row with no submitted_at rather than counting it as zero", () => {
    expect(waitingHours({ submitted_at: null }, NOW)).toBeNull();
  });

  it("returns null for an unparseable timestamp", () => {
    expect(waitingHours({ submitted_at: "not a date" }, NOW)).toBeNull();
  });

  it("never reports a negative wait for a future timestamp", () => {
    expect(waitingHours({ submitted_at: agoHours(-5) }, NOW)).toBe(0);
  });
});

describe("bucketQueueAges", () => {
  it("places each wait in exactly one bucket, on the lower-inclusive edge", () => {
    const buckets = bucketQueueAges(
      [
        { submitted_at: agoHours(1) },
        { submitted_at: agoHours(23.9) },
        { submitted_at: agoHours(24) }, // boundary -> 1-3 days
        { submitted_at: agoHours(71) },
        { submitted_at: agoHours(72) }, // boundary -> 3-7 days
        { submitted_at: agoHours(168) }, // boundary -> 7d+
        { submitted_at: agoHours(400) },
      ],
      NOW,
    );

    expect(buckets.map((b) => [b.key, b.count])).toEqual([
      ["under_24h", 2],
      ["one_to_three_days", 2],
      ["three_to_seven_days", 1],
      ["over_seven_days", 2],
    ]);
  });

  it("keeps empty buckets so the scale never collapses, and skips undated rows", () => {
    const buckets = bucketQueueAges(
      [{ submitted_at: agoHours(2) }, { submitted_at: null }],
      NOW,
    );
    expect(buckets).toHaveLength(4);
    expect(buckets.reduce((total, b) => total + b.count, 0)).toBe(1);
  });

  it("assigns ascending severity steps for the chart ramp", () => {
    expect(bucketQueueAges([], NOW).map((b) => b.step)).toEqual([1, 2, 3, 4]);
  });
});

describe("oldestWaitingHours", () => {
  it("returns the longest wait, ignoring undated rows", () => {
    const oldest = oldestWaitingHours(
      [
        { submitted_at: agoHours(5) },
        { submitted_at: null },
        { submitted_at: agoHours(50) },
      ],
      NOW,
    );
    expect(oldest).toBeCloseTo(50);
  });

  it("returns null when nothing is dated", () => {
    expect(oldestWaitingHours([{ submitted_at: null }], NOW)).toBeNull();
  });
});

describe("sortByLongestWaiting", () => {
  it("puts the longest wait first and undated rows last", () => {
    const rows = [
      { submitted_at: agoHours(2), id: "recent" },
      { submitted_at: null, id: "undated" },
      { submitted_at: agoHours(200), id: "oldest" },
    ];
    expect(sortByLongestWaiting(rows, NOW).map((r) => r.id)).toEqual([
      "oldest",
      "recent",
      "undated",
    ]);
  });

  it("does not mutate its input", () => {
    const rows = [
      { submitted_at: agoHours(2) },
      { submitted_at: agoHours(200) },
    ];
    const snapshot = [...rows];
    sortByLongestWaiting(rows, NOW);
    expect(rows).toEqual(snapshot);
  });
});

describe("summarizeSubmissionKinds", () => {
  it("uses a fixed order independent of rank, and drops empty kinds", () => {
    const mix = summarizeSubmissionKinds([
      { submission_kind: "resubmission" },
      { submission_kind: "resubmission" },
      { submission_kind: "first" },
    ]);
    expect(mix.map((s) => [s.key, s.count])).toEqual([
      ["first", 1],
      ["resubmission", 2],
    ]);
  });
});

describe("report summaries", () => {
  const reports = [
    { category: "harassment", status: "open", created_at: agoHours(1) },
    { category: "misinformation", status: "open", created_at: agoHours(30) },
    {
      category: "misinformation",
      status: "resolved",
      created_at: agoHours(30),
    },
    { category: "other", status: "dismissed", created_at: agoHours(1000) },
  ];

  it("ranks categories by count, breaking ties by label", () => {
    expect(
      summarizeReportCategories(reports).map((s) => [s.key, s.count]),
    ).toEqual([
      ["misinformation", 2],
      ["harassment", 1],
      ["other", 1],
    ]);
  });

  it("keeps statuses in lifecycle order rather than by count", () => {
    expect(summarizeReportStatuses(reports).map((s) => s.key)).toEqual([
      "open",
      "resolved",
      "dismissed",
    ]);
  });
});

describe("buildReportTrend", () => {
  it("emits one point per day including empty days, oldest first", () => {
    const trend = buildReportTrend(
      [
        { created_at: NOW.toISOString() },
        { created_at: new Date(NOW.getTime() - 2 * DAY_MS).toISOString() },
        { created_at: new Date(NOW.getTime() - 2 * DAY_MS).toISOString() },
      ],
      NOW,
      4,
    );

    expect(trend).toEqual([
      { date: "2026-08-19", count: 0 },
      { date: "2026-08-20", count: 2 },
      { date: "2026-08-21", count: 0 },
      { date: "2026-08-22", count: 1 },
    ]);
  });

  it("ignores reports outside the window and unparseable timestamps", () => {
    const trend = buildReportTrend(
      [{ created_at: agoHours(1000) }, { created_at: "nope" }],
      NOW,
      3,
    );
    expect(trend.every((point) => point.count === 0)).toBe(true);
  });
});

describe("formatWait", () => {
  it("reads as a wait, not a timestamp", () => {
    expect(formatWait(0.4)).toBe("<1h");
    expect(formatWait(5.8)).toBe("5h");
    expect(formatWait(26)).toBe("1d 2h");
    expect(formatWait(48)).toBe("2d");
    expect(formatWait(200)).toBe("8d");
  });
});

describe("selectStoriesAssignedTo", () => {
  const entries = [
    { story_id: "a", assigned_editor_id: "me" },
    { story_id: "b", assigned_editor_id: "someone-else" },
    { story_id: "c", assigned_editor_id: null }, // unclaimed pool
    { story_id: "d", assigned_editor_id: "me" },
  ];

  it("keeps only the stories assigned to this viewer", () => {
    expect([...selectStoriesAssignedTo(entries, "me")]).toEqual(["a", "d"]);
  });

  it("excludes unclaimed stories, which /editorial/:id/edit still refuses", () => {
    expect(selectStoriesAssignedTo(entries, "me").has("c")).toBe(false);
  });

  it("returns nothing for a viewer assigned to none of them (an admin, typically)", () => {
    expect(selectStoriesAssignedTo(entries, "admin-id").size).toBe(0);
  });
});
