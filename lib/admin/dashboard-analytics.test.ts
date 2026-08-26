import { describe, expect, it } from "vitest";
import {
  accountLabel,
  buildPipelineStages,
  buildPublicationBlockers,
  countStaff,
  emptyRoleCounts,
  isLastAdminStanding,
  summarizeRoleDistribution,
  type OperationalMetricsLike,
} from "./dashboard-analytics";

function metrics(
  overrides: Partial<OperationalMetricsLike> = {},
): OperationalMetricsLike {
  return {
    draft_imports_count: 0,
    awaiting_contributor_approval_count: 0,
    awaiting_moderation_count: 0,
    published_count: 0,
    missing_consent_count: 0,
    images_missing_alt_text_count: 0,
    open_reports_count: 0,
    ...overrides,
  };
}

describe("buildPipelineStages", () => {
  it("returns the three unpublished stages in pipeline order", () => {
    const stages = buildPipelineStages(
      metrics({
        draft_imports_count: 4,
        awaiting_contributor_approval_count: 2,
        awaiting_moderation_count: 7,
      }),
    );
    expect(stages.map((s) => s.key)).toEqual([
      "draft_imports_count",
      "awaiting_contributor_approval_count",
      "awaiting_moderation_count",
    ]);
    expect(stages.map((s) => s.count)).toEqual([4, 2, 7]);
  });

  it("never includes published — it would swamp every actionable stage", () => {
    const stages = buildPipelineStages(
      metrics({ published_count: 5000, awaiting_moderation_count: 1 }),
    );
    expect(stages.some((s) => s.key === "published_count")).toBe(false);
  });

  it("gives each stage an ascending chart step so the ramp reads as order", () => {
    expect(buildPipelineStages(metrics()).map((s) => s.step)).toEqual([
      1, 2, 3,
    ]);
  });

  it("renders every stage at zero when metrics could not be read", () => {
    const stages = buildPipelineStages(null);
    expect(stages).toHaveLength(3);
    expect(stages.every((s) => s.count === 0)).toBe(true);
  });
});

describe("buildPublicationBlockers", () => {
  it("reports the three blocking signals", () => {
    const blockers = buildPublicationBlockers(
      metrics({
        missing_consent_count: 3,
        images_missing_alt_text_count: 11,
        open_reports_count: 2,
      }),
    );
    expect(blockers.map((b) => [b.key, b.count])).toEqual([
      ["missing_consent", 3],
      ["images_missing_alt_text", 11],
      ["open_reports", 2],
    ]);
  });

  it("keeps zero rows, so an all-clear is legible rather than an empty panel", () => {
    const blockers = buildPublicationBlockers(metrics());
    expect(blockers).toHaveLength(3);
    expect(blockers.every((b) => b.count === 0)).toBe(true);
  });

  it("degrades to zeroes on a null read", () => {
    expect(buildPublicationBlockers(null).map((b) => b.count)).toEqual([
      0, 0, 0,
    ]);
  });
});

describe("summarizeRoleDistribution", () => {
  it("orders roles most-privileged first", () => {
    const slices = summarizeRoleDistribution(
      { admin: 2, moderator: 1, editor: 3, user: 40 },
      46,
    );
    expect(slices.map((s) => s.key)).toEqual([
      "admin",
      "moderator",
      "editor",
      "user",
      "unassigned",
    ]);
  });

  it("surfaces accounts with no role row as their own slice", () => {
    // list_user_accounts() LEFT JOINs user_roles, so the unfiltered total
    // counts accounts that no role filter would ever return.
    const slices = summarizeRoleDistribution(
      { admin: 1, moderator: 0, editor: 1, user: 5 },
      10,
    );
    expect(slices.at(-1)).toEqual({
      key: "unassigned",
      label: "No role assigned",
      count: 3,
    });
  });

  it("clamps the unassigned slice at zero when the five reads disagree", () => {
    // Five separate queries: a role count can legitimately be higher than a
    // total read a moment earlier. That must not render a negative bar.
    const slices = summarizeRoleDistribution(
      { admin: 1, moderator: 1, editor: 1, user: 1 },
      2,
    );
    expect(slices.at(-1)?.count).toBe(0);
  });

  it("handles an empty instance", () => {
    const slices = summarizeRoleDistribution(emptyRoleCounts(), 0);
    expect(slices.every((s) => s.count === 0)).toBe(true);
  });
});

describe("countStaff", () => {
  it("counts everyone who can reach a staff surface, and no one else", () => {
    expect(countStaff({ admin: 2, moderator: 3, editor: 4, user: 100 })).toBe(
      9,
    );
  });
});

describe("isLastAdminStanding", () => {
  it("warns at one admin", () => {
    expect(isLastAdminStanding({ ...emptyRoleCounts(), admin: 1 })).toBe(true);
  });

  it("warns at zero, which should be unreachable but must not read as healthy", () => {
    expect(isLastAdminStanding(emptyRoleCounts())).toBe(true);
  });

  it("does not warn once a second admin exists", () => {
    expect(isLastAdminStanding({ ...emptyRoleCounts(), admin: 2 })).toBe(false);
  });
});

describe("accountLabel", () => {
  const userId = "9f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f";

  it("prefers the display name", () => {
    expect(accountLabel({ display_name: "Mei Ling", user_id: userId })).toBe(
      "Mei Ling",
    );
  });

  it("falls back to a short id, never to an email", () => {
    expect(accountLabel({ display_name: null, user_id: userId })).toBe(
      "Unnamed account 9f1c2d3e",
    );
    expect(accountLabel({ display_name: "   ", user_id: userId })).toBe(
      "Unnamed account 9f1c2d3e",
    );
  });
});
