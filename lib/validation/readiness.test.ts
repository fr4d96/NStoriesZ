import { describe, expect, it } from "vitest";
import {
  parseReadinessQueueSearchParams,
  recordLaunchVerificationSchema,
  READINESS_QUEUE_PAGE_SIZE,
} from "@/lib/validation/readiness";

describe("parseReadinessQueueSearchParams", () => {
  it("defaults to page 1 with no filters", () => {
    expect(parseReadinessQueueSearchParams({})).toEqual({ page: 1 });
  });

  it("parses valid sourceKind and lifecycleStatus", () => {
    expect(
      parseReadinessQueueSearchParams({
        sourceKind: "editorial_import",
        lifecycleStatus: "published",
      }),
    ).toEqual({
      sourceKind: "editorial_import",
      lifecycleStatus: "published",
      page: 1,
    });
  });

  it("silently drops an invalid field instead of throwing", () => {
    expect(
      parseReadinessQueueSearchParams({
        sourceKind: "not-a-real-kind",
        lifecycleStatus: "published",
      }),
    ).toEqual({ lifecycleStatus: "published", page: 1 });
  });

  it("silently drops a non-numeric page", () => {
    expect(parseReadinessQueueSearchParams({ page: "not-a-number" })).toEqual({
      page: 1,
    });
  });

  it("takes the first value when a param is an array", () => {
    expect(
      parseReadinessQueueSearchParams({
        sourceKind: ["editorial_import", "self_submitted"],
      }),
    ).toEqual({ sourceKind: "editorial_import", page: 1 });
  });
});

describe("READINESS_QUEUE_PAGE_SIZE", () => {
  it("is a positive, reasonably small page size", () => {
    expect(READINESS_QUEUE_PAGE_SIZE).toBeGreaterThan(0);
    expect(READINESS_QUEUE_PAGE_SIZE).toBeLessThanOrEqual(50);
  });
});

describe("recordLaunchVerificationSchema", () => {
  const validStoryId = "11111111-1111-4111-8111-111111111111";

  it("accepts desktop-only", () => {
    const result = recordLaunchVerificationSchema.safeParse({
      storyId: validStoryId,
      desktopChecked: true,
      mobileChecked: false,
    });
    expect(result.success).toBe(true);
  });

  it("accepts mobile-only", () => {
    const result = recordLaunchVerificationSchema.safeParse({
      storyId: validStoryId,
      desktopChecked: false,
      mobileChecked: true,
    });
    expect(result.success).toBe(true);
  });

  it("rejects neither desktop nor mobile checked", () => {
    const result = recordLaunchVerificationSchema.safeParse({
      storyId: validStoryId,
      desktopChecked: false,
      mobileChecked: false,
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid storyId", () => {
    const result = recordLaunchVerificationSchema.safeParse({
      storyId: "not-a-uuid",
      desktopChecked: true,
      mobileChecked: false,
    });
    expect(result.success).toBe(false);
  });

  it("accepts an optional note", () => {
    const result = recordLaunchVerificationSchema.safeParse({
      storyId: validStoryId,
      desktopChecked: true,
      mobileChecked: true,
      note: "Checked on an iPhone and a laptop.",
    });
    expect(result.success).toBe(true);
  });
});
