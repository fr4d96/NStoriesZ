import { describe, expect, it } from "vitest";
import { parseUserAccountsSearchParams, setUserRoleSchema } from "./admin";

describe("parseUserAccountsSearchParams", () => {
  it("defaults to page 1 with no filters", () => {
    expect(parseUserAccountsSearchParams({})).toEqual({ page: 1 });
  });

  it("parses search, role, and page", () => {
    expect(
      parseUserAccountsSearchParams({
        search: "  kaki ",
        role: "editor",
        page: "3",
      }),
    ).toEqual({ search: "kaki", role: "editor", page: 3 });
  });

  it("drops a bad field without failing the whole page", () => {
    // Same convention as the moderation/editorial queue parsers: a
    // tampered query string is never a 500, and never blocks the other
    // filters from applying.
    expect(
      parseUserAccountsSearchParams({ role: "superuser", search: "kaki" }),
    ).toEqual({ search: "kaki", page: 1 });
    expect(parseUserAccountsSearchParams({ page: "0" })).toEqual({ page: 1 });
    expect(parseUserAccountsSearchParams({ page: "abc" })).toEqual({ page: 1 });
  });

  it("takes the first value of a repeated param", () => {
    expect(
      parseUserAccountsSearchParams({ role: ["moderator", "admin"] }),
    ).toEqual({ role: "moderator", page: 1 });
  });
});

describe("setUserRoleSchema", () => {
  it("accepts a uuid and a known role", () => {
    const parsed = setUserRoleSchema.safeParse({
      userId: "11111111-1111-4111-8111-111111111111",
      role: "admin",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an unknown role", () => {
    expect(
      setUserRoleSchema.safeParse({
        userId: "11111111-1111-4111-8111-111111111111",
        role: "superuser",
      }).success,
    ).toBe(false);
  });

  it("rejects a non-uuid user id", () => {
    expect(
      setUserRoleSchema.safeParse({ userId: "not-a-uuid", role: "user" })
        .success,
    ).toBe(false);
  });

  it("rejects a missing role", () => {
    expect(
      setUserRoleSchema.safeParse({
        userId: "11111111-1111-4111-8111-111111111111",
      }).success,
    ).toBe(false);
  });
});
