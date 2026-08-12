import { describe, expect, it } from "vitest";
import { defaultPathForRole } from "./post-login-redirect";

describe("defaultPathForRole", () => {
  it("sends a moderator to the moderation dashboard", () => {
    expect(defaultPathForRole("moderator")).toBe("/moderation");
  });

  it("sends an editor to the editorial dashboard", () => {
    expect(defaultPathForRole("editor")).toBe("/editorial");
  });

  it("sends an admin to the moderation dashboard (no standalone admin dashboard exists yet)", () => {
    expect(defaultPathForRole("admin")).toBe("/moderation");
  });

  it("sends an ordinary user to My Stories", () => {
    expect(defaultPathForRole("user")).toBe("/my-stories");
  });

  it("falls back to My Stories for a null role", () => {
    expect(defaultPathForRole(null)).toBe("/my-stories");
  });
});
