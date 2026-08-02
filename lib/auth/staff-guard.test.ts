import { describe, expect, it } from "vitest";
import { resolveStaffAccess } from "./staff-guard";

describe("resolveStaffAccess", () => {
  it("denies access when signed out (role is null)", () => {
    expect(resolveStaffAccess(null, ["admin"])).toEqual({ ok: false });
  });

  it("denies access for a signed-in user with an insufficient role", () => {
    expect(resolveStaffAccess("user", ["editor", "admin"])).toEqual({
      ok: false,
    });
    expect(resolveStaffAccess("editor", ["moderator", "admin"])).toEqual({
      ok: false,
    });
  });

  it("grants access when the role is in the allowed list", () => {
    expect(resolveStaffAccess("editor", ["editor", "admin"])).toEqual({
      ok: true,
      role: "editor",
    });
    expect(resolveStaffAccess("admin", ["editor", "admin"])).toEqual({
      ok: true,
      role: "admin",
    });
  });

  it("never grants access to a role not explicitly allowed, even admin, unless listed", () => {
    expect(resolveStaffAccess("admin", ["moderator"])).toEqual({
      ok: false,
    });
  });
});
