import { describe, expect, it } from "vitest";
import { profileUpdateSchema, createOwnContributorSchema } from "./profile";

// 20260910090000 moved every publicly visible field off profiles and onto
// contributors. The bio / home country / public slug cases that used to sit
// under profileUpdateSchema therefore moved down to
// createOwnContributorSchema rather than being deleted -- the rules still
// have to hold, just on the schema that now owns them.
describe("profileUpdateSchema", () => {
  const base = { displayName: "Casey" };

  it("accepts a minimal valid profile", () => {
    expect(profileUpdateSchema.safeParse(base).success).toBe(true);
  });

  it("rejects an empty display name", () => {
    expect(
      profileUpdateSchema.safeParse({ ...base, displayName: "  " }).success,
    ).toBe(false);
  });

  it("rejects a display name over the length limit", () => {
    expect(
      profileUpdateSchema.safeParse({ displayName: "a".repeat(121) }).success,
    ).toBe(false);
  });

  // The account schema must not quietly keep accepting public fields: a
  // stale form still posting `publicSlug` would otherwise look like it
  // saved something. Zod strips unknown keys, so the proof is that the
  // parsed OUTPUT carries nothing but the display name.
  it("carries no public identity fields through", () => {
    const parsed = profileUpdateSchema.safeParse({
      ...base,
      bio: "should be ignored",
      homeCountryCode: "MY",
      publicSlug: "casey-nz-2024",
      publicProfileEnabled: true,
      avatarEmoji: "🥝",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual({ displayName: "Casey" });
  });
});

describe("createOwnContributorSchema", () => {
  const base = {
    displayName: "Casey C.",
    attributionType: "pseudonym" as const,
    publicProfileEnabled: false,
  };

  it("accepts a valid attribution type", () => {
    expect(createOwnContributorSchema.safeParse(base).success).toBe(true);
  });

  it("rejects an attribution type outside the allowed enum", () => {
    expect(
      createOwnContributorSchema.safeParse({
        ...base,
        attributionType: "admin",
      }).success,
    ).toBe(false);
  });

  it("rejects a malformed public slug", () => {
    expect(
      createOwnContributorSchema.safeParse({
        ...base,
        publicSlug: "Not A Slug!",
      }).success,
    ).toBe(false);
  });

  it("accepts a well-formed public slug", () => {
    expect(
      createOwnContributorSchema.safeParse({
        ...base,
        publicSlug: "casey-nz-2024",
      }).success,
    ).toBe(true);
  });

  it("rejects a bio over the length limit", () => {
    expect(
      createOwnContributorSchema.safeParse({ ...base, bio: "a".repeat(2001) })
        .success,
    ).toBe(false);
  });

  it("rejects a home country code that isn't a 2-letter code", () => {
    expect(
      createOwnContributorSchema.safeParse({
        ...base,
        homeCountryCode: "MYS",
      }).success,
    ).toBe(false);
  });

  // Unlike the old profiles column, which defaulted to MY, an unset home
  // country is valid and means "don't publish one" -- see the column
  // comment in 20260910090000.
  it("accepts an unset home country", () => {
    expect(
      createOwnContributorSchema.safeParse({ ...base, homeCountryCode: "" })
        .success,
    ).toBe(true);
  });

  it("rejects an avatar emoji outside the fixed set", () => {
    expect(
      createOwnContributorSchema.safeParse({ ...base, avatarEmoji: "💀" })
        .success,
    ).toBe(false);
  });

  it("accepts an avatar emoji from the fixed set", () => {
    expect(
      createOwnContributorSchema.safeParse({ ...base, avatarEmoji: "🥝" })
        .success,
    ).toBe(true);
  });
});
