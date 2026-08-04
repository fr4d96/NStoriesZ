import { describe, expect, it } from "vitest";
import { parseStorySearchParams } from "./discovery";

describe("parseStorySearchParams", () => {
  it("parses every valid field", () => {
    const result = parseStorySearchParams({
      region: "11111111-1111-4111-8111-111111111111",
      destination: "22222222-2222-4222-8222-222222222222",
      workType: "33333333-3333-4333-8333-333333333333",
      tag: "44444444-4444-4444-8444-444444444444",
      tripYear: "2024",
      travelStyle: "budget",
      costBand: "5k_15k",
      hasReportedExpense: "true",
      q: "hawke's bay",
      cursorPublishedAt: "2024-01-01T00:00:00.000Z",
      cursorId: "55555555-5555-4555-8555-555555555555",
    });
    expect(result).toEqual({
      region: "11111111-1111-4111-8111-111111111111",
      destination: "22222222-2222-4222-8222-222222222222",
      workType: "33333333-3333-4333-8333-333333333333",
      tag: "44444444-4444-4444-8444-444444444444",
      tripYear: 2024,
      travelStyle: "budget",
      costBand: "5k_15k",
      hasReportedExpense: true,
      q: "hawke's bay",
      cursorPublishedAt: "2024-01-01T00:00:00.000Z",
      cursorId: "55555555-5555-4555-8555-555555555555",
    });
  });

  it("returns an empty object for no params", () => {
    expect(parseStorySearchParams({})).toEqual({});
  });

  it("drops an invalid uuid field but keeps other valid fields", () => {
    const result = parseStorySearchParams({
      region: "not-a-uuid",
      travelStyle: "budget",
    });
    expect(result).toEqual({ travelStyle: "budget" });
  });

  it("drops an invalid cost band", () => {
    expect(parseStorySearchParams({ costBand: "sky-high" })).toEqual({});
  });

  it("drops an out-of-range trip year", () => {
    expect(parseStorySearchParams({ tripYear: "1899" })).toEqual({});
    expect(parseStorySearchParams({ tripYear: "not-a-number" })).toEqual({});
  });

  it("drops a malformed cursor, falling back to no cursor (first page)", () => {
    const result = parseStorySearchParams({
      cursorPublishedAt: "not-a-date",
      cursorId: "also-not-a-uuid",
      region: "11111111-1111-4111-8111-111111111111",
    });
    expect(result).toEqual({ region: "11111111-1111-4111-8111-111111111111" });
  });

  it("takes the first value when a param is duplicated", () => {
    const result = parseStorySearchParams({
      travelStyle: ["budget", "comfort"],
    });
    expect(result).toEqual({ travelStyle: "budget" });
  });

  it("coerces hasReportedExpense=false correctly (not just truthy string)", () => {
    expect(parseStorySearchParams({ hasReportedExpense: "false" })).toEqual({
      hasReportedExpense: false,
    });
  });

  it("drops an empty or overlong search string", () => {
    expect(parseStorySearchParams({ q: "" })).toEqual({});
    expect(parseStorySearchParams({ q: "a".repeat(201) })).toEqual({});
  });
});
