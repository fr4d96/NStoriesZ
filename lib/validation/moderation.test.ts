import { describe, expect, it } from "vitest";
import {
  parseModerationQueueSearchParams,
  parseEditorialQueueSearchParams,
  parseReportsQueueSearchParams,
  moderateDecisionSchema,
  archiveStorySchema,
  resolveReportSchema,
  reportNoteRequired,
  SERIOUS_REPORT_CATEGORIES,
} from "./moderation";

describe("parseModerationQueueSearchParams", () => {
  it("parses every valid field", () => {
    const result = parseModerationQueueSearchParams({
      status: "recently_reviewed",
      sourceKind: "editorial_import",
      regionId: "11111111-1111-4111-8111-111111111111",
      consentMethod: "email",
      dateFrom: "2026-01-01",
      dateTo: "2026-02-01",
      page: "3",
    });
    expect(result).toEqual({
      status: "recently_reviewed",
      sourceKind: "editorial_import",
      regionId: "11111111-1111-4111-8111-111111111111",
      consentMethod: "email",
      dateFrom: "2026-01-01",
      dateTo: "2026-02-01",
      page: 3,
    });
  });

  it("defaults to page 1 with no params", () => {
    expect(parseModerationQueueSearchParams({})).toEqual({ page: 1 });
  });

  it("drops an invalid field but keeps the rest, and never throws", () => {
    const result = parseModerationQueueSearchParams({
      status: "not-a-real-status",
      sourceKind: "editorial_import",
      page: "not-a-number",
    });
    expect(result).toEqual({ sourceKind: "editorial_import", page: 1 });
  });

  it("drops a negative or zero page number", () => {
    expect(parseModerationQueueSearchParams({ page: "0" })).toEqual({
      page: 1,
    });
    expect(parseModerationQueueSearchParams({ page: "-5" })).toEqual({
      page: 1,
    });
  });

  it("takes the first value of a repeated param", () => {
    const result = parseModerationQueueSearchParams({
      status: ["submitted", "recently_reviewed"],
    });
    expect(result.status).toBe("submitted");
  });
});

describe("parseEditorialQueueSearchParams", () => {
  it("parses status/search/page", () => {
    const result = parseEditorialQueueSearchParams({
      status: "changes_requested",
      search: "auckland",
      page: "2",
    });
    expect(result).toEqual({
      status: "changes_requested",
      search: "auckland",
      page: 2,
    });
  });

  it("defaults to page 1 with no params", () => {
    expect(parseEditorialQueueSearchParams({})).toEqual({ page: 1 });
  });

  it("drops an unknown status value", () => {
    const result = parseEditorialQueueSearchParams({ status: "bogus" });
    expect(result).toEqual({ page: 1 });
  });
});

describe("moderateDecisionSchema", () => {
  it("requires a non-empty userFacingReason", () => {
    const result = moderateDecisionSchema.safeParse({
      revisionId: "11111111-1111-4111-8111-111111111111",
      expectedVersion: 1,
      decision: "reject",
      userFacingReason: "",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid reject decision", () => {
    const result = moderateDecisionSchema.safeParse({
      revisionId: "11111111-1111-4111-8111-111111111111",
      expectedVersion: 1,
      decision: "reject",
      userFacingReason: "Missing required trip dates.",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown decision value", () => {
    const result = moderateDecisionSchema.safeParse({
      revisionId: "11111111-1111-4111-8111-111111111111",
      expectedVersion: 1,
      decision: "approve",
      userFacingReason: "x",
    });
    expect(result.success).toBe(false);
  });
});

describe("parseReportsQueueSearchParams", () => {
  it("parses every valid field", () => {
    const result = parseReportsQueueSearchParams({
      status: "reviewing",
      category: "harassment",
      dateFrom: "2026-01-01",
      dateTo: "2026-02-01",
      page: "2",
    });
    expect(result).toEqual({
      status: "reviewing",
      category: "harassment",
      dateFrom: "2026-01-01",
      dateTo: "2026-02-01",
      page: 2,
    });
  });

  it("defaults to page 1 with no params", () => {
    expect(parseReportsQueueSearchParams({})).toEqual({ page: 1 });
  });

  it("drops an invalid field but keeps the rest, and never throws", () => {
    const result = parseReportsQueueSearchParams({
      status: "not-a-real-status",
      category: "harassment",
      page: "not-a-number",
    });
    expect(result).toEqual({ category: "harassment", page: 1 });
  });

  it("takes the first value of a repeated param", () => {
    const result = parseReportsQueueSearchParams({
      status: ["open", "reviewing"],
    });
    expect(result.status).toBe("open");
  });
});

describe("archiveStorySchema", () => {
  it("requires a non-empty reason", () => {
    const result = archiveStorySchema.safeParse({
      storyId: "11111111-1111-4111-8111-111111111111",
      revisionId: "22222222-2222-4222-8222-222222222222",
      expectedVersion: 1,
      reason: "   ",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid archive request", () => {
    const result = archiveStorySchema.safeParse({
      storyId: "11111111-1111-4111-8111-111111111111",
      revisionId: "22222222-2222-4222-8222-222222222222",
      expectedVersion: 4,
      reason: "Contributor requested removal.",
    });
    expect(result.success).toBe(true);
  });
});

describe("resolveReportSchema", () => {
  it("accepts a reviewing transition with no note", () => {
    const result = resolveReportSchema.safeParse({
      reportId: "11111111-1111-4111-8111-111111111111",
      status: "reviewing",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a resolved transition with a note", () => {
    const result = resolveReportSchema.safeParse({
      reportId: "11111111-1111-4111-8111-111111111111",
      status: "resolved",
      internalNote: "Verified against the official INZ guidance page.",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown status value", () => {
    const result = resolveReportSchema.safeParse({
      reportId: "11111111-1111-4111-8111-111111111111",
      status: "closed",
    });
    expect(result.success).toBe(false);
  });

  // The schema itself does not enforce the serious-category note
  // requirement (that's a conditional rule, not a per-field shape) --
  // reportNoteRequired() below is the client-side mirror, and
  // resolve_report() itself is the actual non-bypassable source of truth
  // (Engineering Rule 3).
  it("SERIOUS_REPORT_CATEGORIES matches story_reports_category_check's four serious values", () => {
    expect(SERIOUS_REPORT_CATEGORIES).toEqual([
      "misinformation",
      "unsafe_employment_advice",
      "harassment",
      "copyright_privacy",
    ]);
  });
});

describe("reportNoteRequired", () => {
  it("is required for a serious category when closing", () => {
    expect(reportNoteRequired("harassment", "resolved")).toBe(true);
    expect(reportNoteRequired("misinformation", "dismissed")).toBe(true);
  });

  it("is never required on the reviewing transition, even for a serious category", () => {
    expect(reportNoteRequired("harassment", "reviewing")).toBe(false);
  });

  it("is not required for a non-serious category when closing", () => {
    expect(reportNoteRequired("spam_commercial", "resolved")).toBe(false);
    expect(reportNoteRequired("other", "dismissed")).toBe(false);
  });
});
