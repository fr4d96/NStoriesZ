import { describe, it, expect } from "vitest";
import {
  SUBMISSION_KIND_LABELS,
  SOURCE_KIND_LABELS,
  DECISION_LABELS,
  labelFor,
  isEmptySubmission,
  queueSignals,
  contentLengthLabel,
  relativeTime,
  absoluteTime,
  submitterLabel,
} from "./moderation-queue-view";

const baseRow = {
  content_text_length: 500,
  image_count: 0,
  location_count: 1,
  tag_count: 2,
  open_report_count: 0,
};

describe("labelFor", () => {
  it("maps a known value and falls back to the raw string", () => {
    expect(labelFor(SUBMISSION_KIND_LABELS, "first")).toBe("First submission");
    expect(labelFor(SOURCE_KIND_LABELS, "editorial_import")).toBe(
      "Editorial import",
    );
    expect(labelFor(DECISION_LABELS, "approved")).toBe("Approved");
    // An unknown status is shown, never swallowed -- a moderator seeing a
    // raw enum value is strictly better than seeing nothing.
    expect(labelFor(DECISION_LABELS, "some_new_status")).toBe(
      "some_new_status",
    );
  });

  it("returns null for null/empty input", () => {
    expect(labelFor(SOURCE_KIND_LABELS, null)).toBeNull();
    expect(labelFor(SOURCE_KIND_LABELS, undefined)).toBeNull();
    expect(labelFor(SOURCE_KIND_LABELS, "")).toBeNull();
  });
});

describe("isEmptySubmission", () => {
  it("is true only at exactly zero characters", () => {
    expect(isEmptySubmission({ content_text_length: 0 })).toBe(true);
    expect(isEmptySubmission({ content_text_length: 1 })).toBe(false);
    expect(isEmptySubmission({ content_text_length: 5000 })).toBe(false);
  });
});

describe("queueSignals", () => {
  it("emits nothing for a complete, unreported, photo-less submission", () => {
    expect(queueSignals(baseRow)).toEqual([]);
  });

  it("leads with the empty-submission flag", () => {
    const signals = queueSignals({ ...baseRow, content_text_length: 0 });
    expect(signals[0]).toEqual({
      id: "no-content",
      label: "No story content",
      tone: "alert",
    });
  });

  it("orders alerts before warnings before the neutral photo count", () => {
    const signals = queueSignals({
      content_text_length: 0,
      image_count: 3,
      location_count: 0,
      tag_count: 0,
      open_report_count: 2,
    });
    expect(signals.map((s) => s.id)).toEqual([
      "no-content",
      "reports",
      "no-place",
      "no-tags",
      "photos",
    ]);
    expect(signals.map((s) => s.tone)).toEqual([
      "alert",
      "alert",
      "warn",
      "warn",
      "neutral",
    ]);
  });

  it("singularises report and photo counts", () => {
    const one = queueSignals({
      ...baseRow,
      open_report_count: 1,
      image_count: 1,
    });
    expect(one.map((s) => s.label)).toEqual(["1 open report", "1 photo"]);

    const many = queueSignals({
      ...baseRow,
      open_report_count: 4,
      image_count: 12,
    });
    expect(many.map((s) => s.label)).toEqual(["4 open reports", "12 photos"]);
  });

  it("does not emit a photo chip when there are no photos", () => {
    expect(queueSignals(baseRow).some((s) => s.id === "photos")).toBe(false);
  });
});

describe("contentLengthLabel", () => {
  it("says Empty at zero rather than '0 characters'", () => {
    expect(contentLengthLabel(0)).toBe("Empty");
  });

  it("groups thousands", () => {
    expect(contentLengthLabel(1)).toBe("1 characters");
    expect(contentLengthLabel(4321)).toBe("4,321 characters");
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-09-02T12:00:00.000Z");

  it("returns null for null or unparseable input", () => {
    expect(relativeTime(null, now)).toBeNull();
    expect(relativeTime("not a date", now)).toBeNull();
  });

  it("collapses anything under a minute, including clock skew from the future", () => {
    expect(relativeTime("2026-09-02T11:59:31.000Z", now)).toBe("just now");
    // A row written by a database clock slightly ahead of this process must
    // not render as a negative duration.
    expect(relativeTime("2026-09-02T12:00:30.000Z", now)).toBe("just now");
  });

  it("counts minutes, hours and days", () => {
    expect(relativeTime("2026-09-02T11:46:00.000Z", now)).toBe("14 min ago");
    expect(relativeTime("2026-09-02T11:00:00.000Z", now)).toBe("1 hour ago");
    expect(relativeTime("2026-09-02T07:00:00.000Z", now)).toBe("5 hours ago");
    expect(relativeTime("2026-09-01T12:00:00.000Z", now)).toBe("1 day ago");
    expect(relativeTime("2026-08-28T12:00:00.000Z", now)).toBe("5 days ago");
  });

  it("switches to an absolute date past a week", () => {
    // "43 days ago" is not a unit anyone triages in. Asserted on shape
    // rather than an exact string: toLocaleDateString() resolves in the
    // running process's zone, so pinning "1 Aug" would pass on a
    // Pacific/Auckland machine and fail on a UTC one -- a timezone
    // assertion masquerading as a formatting one.
    const sameYear = relativeTime("2026-08-01T12:00:00.000Z", now)!;
    expect(sameYear).toContain("Aug");
    expect(sameYear).not.toContain("ago");
    expect(sameYear).not.toContain("2026");

    // A different year KEEPS the year, so an old fixture is never mistaken
    // for a recent submission. This is the rule worth pinning.
    const otherYear = relativeTime("2025-08-01T12:00:00.000Z", now)!;
    expect(otherYear).toContain("2025");
    expect(otherYear).not.toContain("ago");
  });
});

describe("absoluteTime", () => {
  it("returns null for null or unparseable input", () => {
    expect(absoluteTime(null)).toBeNull();
    expect(absoluteTime("nope")).toBeNull();
  });

  it("renders a full timestamp", () => {
    const value = absoluteTime("2026-08-28T03:11:00.000Z");
    expect(value).toContain("2026");
    expect(value).toContain("Aug");
  });
});

describe("submitterLabel", () => {
  it("names the contributor", () => {
    expect(
      submitterLabel({
        contributor_display_name: "Wei Ling",
        source_kind: "self_submitted",
      }),
    ).toBe("Wei Ling");
  });

  it("names both the contributor and the fact staff prepared an import", () => {
    expect(
      submitterLabel({
        contributor_display_name: "Wei Ling",
        source_kind: "editorial_import",
      }),
    ).toBe("Wei Ling (via editorial import)");
  });

  it("never renders an empty or missing name as blank", () => {
    expect(
      submitterLabel({ contributor_display_name: null, source_kind: null }),
    ).toBe("Unknown contributor");
    expect(
      submitterLabel({
        contributor_display_name: "   ",
        source_kind: "self_submitted",
      }),
    ).toBe("Unknown contributor");
  });
});
