import { describe, expect, it } from "vitest";
import { profileUpdateSchema, createOwnContributorSchema } from "./profile";

describe("profileUpdateSchema", () => {
  const base = {
    displayName: "Casey",
    homeCountryCode: "MY",
    publicProfileEnabled: false,
  };

  it("accepts a minimal valid profile", () => {
    expect(profileUpdateSchema.safeParse(base).success).toBe(true);
  });

  it("rejects a home country code that isn't a 2-letter code", () => {
    expect(
      profileUpdateSchema.safeParse({ ...base, homeCountryCode: "MYS" })
        .success,
    ).toBe(false);
  });

  it("rejects a bio over the length limit", () => {
    expect(
      profileUpdateSchema.safeParse({ ...base, bio: "a".repeat(2001) }).success,
    ).toBe(false);
  });

  it("rejects a malformed public slug", () => {
    expect(
      profileUpdateSchema.safeParse({ ...base, publicSlug: "Not A Slug!" })
        .success,
    ).toBe(false);
  });

  it("accepts a well-formed public slug", () => {
    expect(
      profileUpdateSchema.safeParse({ ...base, publicSlug: "casey-nz-2024" })
        .success,
    ).toBe(true);
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
});
