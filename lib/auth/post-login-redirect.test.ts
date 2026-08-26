import { describe, expect, it } from "vitest";
import {
  CONTRIBUTOR_SETUP_PATH,
  defaultPathForRole,
  landingPathAfterSignIn,
} from "./post-login-redirect";

describe("defaultPathForRole", () => {
  it("sends a moderator to the moderation dashboard", () => {
    expect(defaultPathForRole("moderator")).toBe("/moderation");
  });

  it("sends an editor to the editorial dashboard", () => {
    expect(defaultPathForRole("editor")).toBe("/editorial");
  });

  it("sends an admin to the admin dashboard, not to /moderation", () => {
    // Phase 2 replaced the /admin placeholder Route Handler with a real
    // dashboard, which is what retired the old /moderation fallback.
    expect(defaultPathForRole("admin")).toBe("/admin");
  });

  it("sends an ordinary user to My Stories", () => {
    expect(defaultPathForRole("user")).toBe("/my-stories");
  });

  it("falls back to My Stories for a null role", () => {
    expect(defaultPathForRole(null)).toBe("/my-stories");
  });
});

describe("landingPathAfterSignIn", () => {
  it("sends a brand new account (no contributor identity yet) to set one up", () => {
    expect(landingPathAfterSignIn("user", false)).toBe(CONTRIBUTOR_SETUP_PATH);
    expect(landingPathAfterSignIn(null, false)).toBe(CONTRIBUTOR_SETUP_PATH);
  });

  it("sends a returning contributor to My Stories", () => {
    expect(landingPathAfterSignIn("user", true)).toBe("/my-stories");
  });

  it("never diverts a staff role, with or without a contributor identity", () => {
    for (const hasIdentity of [true, false]) {
      expect(landingPathAfterSignIn("moderator", hasIdentity)).toBe(
        "/moderation",
      );
      expect(landingPathAfterSignIn("admin", hasIdentity)).toBe("/admin");
      expect(landingPathAfterSignIn("editor", hasIdentity)).toBe("/editorial");
    }
  });
});
