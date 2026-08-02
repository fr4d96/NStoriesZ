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
  it("accepts a valid attribution type", () => {
    expect(
      createOwnContributorSchema.safeParse({
        displayName: "Casey C.",
        attributionType: "pseudonym",
      }).success,
    ).toBe(true);
  });

  it("rejects an attribution type outside the allowed enum", () => {
    expect(
      createOwnContributorSchema.safeParse({
        displayName: "Casey C.",
        attributionType: "admin",
      }).success,
    ).toBe(false);
  });
});
