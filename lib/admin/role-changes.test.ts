import { describe, expect, it } from "vitest";
import {
  buildRoleOptions,
  formatSignIn,
  isLastAdminError,
  parseActivity,
  resolveRoleChangeAvailability,
} from "./role-changes";

const VIEWER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

describe("resolveRoleChangeAvailability", () => {
  it("refuses a no-op", () => {
    expect(
      resolveRoleChangeAvailability({
        viewerUserId: VIEWER,
        targetUserId: OTHER,
        targetRole: "editor",
        nextRole: "editor",
        adminCount: 2,
      }),
    ).toEqual({ allowed: false, reason: "Already this role." });
  });

  it("allows an ordinary promotion", () => {
    expect(
      resolveRoleChangeAvailability({
        viewerUserId: VIEWER,
        targetUserId: OTHER,
        targetRole: "user",
        nextRole: "editor",
        adminCount: 1,
      }),
    ).toEqual({ allowed: true });
  });

  it("refuses self-demotion, mirroring admin_set_user_role()", () => {
    const result = resolveRoleChangeAvailability({
      viewerUserId: VIEWER,
      targetUserId: VIEWER,
      targetRole: "admin",
      nextRole: "moderator",
      adminCount: 5,
    });
    expect(result.allowed).toBe(false);
  });

  it("still allows promoting oneself to admin (a no-op guard, not a block)", () => {
    // The DB guard is specifically `p_target_user_id = auth.uid() and
    // p_role <> 'admin'` -- self -> admin is not a demotion, so it must not
    // be caught by the self rule. (It is caught by the no-op rule above
    // only when they already hold admin.)
    expect(
      resolveRoleChangeAvailability({
        viewerUserId: VIEWER,
        targetUserId: VIEWER,
        targetRole: "moderator",
        nextRole: "admin",
        adminCount: 1,
      }),
    ).toEqual({ allowed: true });
  });

  it("allows demoting a PEER admin while another admin remains", () => {
    // Deliberate product decision: peer demotion is allowed. Two admins
    // exist, so demoting the other one still leaves the viewer.
    expect(
      resolveRoleChangeAvailability({
        viewerUserId: VIEWER,
        targetUserId: OTHER,
        targetRole: "admin",
        nextRole: "user",
        adminCount: 2,
      }),
    ).toEqual({ allowed: true });
  });

  it("refuses a demotion that would leave zero admins", () => {
    const result = resolveRoleChangeAvailability({
      viewerUserId: VIEWER,
      targetUserId: OTHER,
      targetRole: "admin",
      nextRole: "user",
      adminCount: 1,
    });
    expect(result).toEqual({
      allowed: false,
      reason: "This is the last admin — promote another admin first.",
    });
  });

  it("does not apply the last-admin rule to a non-admin target", () => {
    expect(
      resolveRoleChangeAvailability({
        viewerUserId: VIEWER,
        targetUserId: OTHER,
        targetRole: "moderator",
        nextRole: "user",
        adminCount: 1,
      }),
    ).toEqual({ allowed: true });
  });

  it("treats a missing role row as demotable without tripping the admin rule", () => {
    expect(
      resolveRoleChangeAvailability({
        viewerUserId: VIEWER,
        targetUserId: OTHER,
        targetRole: null,
        nextRole: "user",
        adminCount: 1,
      }),
    ).toEqual({ allowed: true });
  });
});

describe("buildRoleOptions", () => {
  it("returns every role in a fixed order, annotated", () => {
    const options = buildRoleOptions({
      viewerUserId: VIEWER,
      targetUserId: OTHER,
      targetRole: "admin",
      adminCount: 1,
    });
    expect(options.map((o) => o.role)).toEqual([
      "user",
      "editor",
      "moderator",
      "admin",
    ]);
    // Last admin: every demotion blocked, the no-op self-role blocked too.
    expect(options.filter((o) => o.availability.allowed)).toHaveLength(0);
  });
});

describe("isLastAdminError", () => {
  it("recognises SQLSTATE WHV02", () => {
    expect(isLastAdminError({ code: "WHV02", message: "…" })).toBe(true);
  });

  it("ignores other errors", () => {
    expect(isLastAdminError({ code: "WHV01" })).toBe(false);
    expect(isLastAdminError(new Error("boom"))).toBe(false);
    expect(isLastAdminError(null)).toBe(false);
    expect(isLastAdminError(undefined)).toBe(false);
  });
});

describe("formatSignIn", () => {
  it("says Never for a null timestamp", () => {
    expect(formatSignIn(null)).toBe("Never");
  });

  it("says Unknown for an unparseable timestamp", () => {
    expect(formatSignIn("not-a-date")).toBe("Unknown");
  });

  it("formats a real timestamp", () => {
    expect(formatSignIn("2026-08-23T07:18:05.835Z")).not.toBe("Never");
  });
});

describe("parseActivity", () => {
  it("returns an empty array for anything that is not an array", () => {
    expect(parseActivity(null)).toEqual([]);
    expect(parseActivity({})).toEqual([]);
    expect(parseActivity("[]")).toEqual([]);
  });

  it("keeps well-formed entries and drops malformed ones", () => {
    const good = {
      kind: "moderation",
      story_id: "s1",
      story_slug: "a-slug",
      label: "approved",
      created_at: "2026-08-16T05:03:10.258Z",
    };
    expect(parseActivity([good, { kind: "editorial" }, 42, null])).toEqual([
      good,
    ]);
  });
});
