import { describe, expect, it } from "vitest";
import { staffMenuItemsForRole } from "./staff-menu";

/**
 * These tests exist to keep the menu honest against proxy.ts. A link that
 * 404s for the very role it was rendered for is the failure mode worth
 * guarding, so the assertions are written as "who may reach this path",
 * mirroring proxy.ts's gates rather than the menu's own shape.
 */
const hrefs = (role: Parameters<typeof staffMenuItemsForRole>[0]) =>
  staffMenuItemsForRole(role).map((item) => item.href);

describe("staffMenuItemsForRole", () => {
  it("gives an ordinary contributor no staff links at all", () => {
    expect(staffMenuItemsForRole("user")).toEqual([]);
  });

  it("gives a signed-out caller no staff links at all", () => {
    expect(staffMenuItemsForRole(null)).toEqual([]);
  });

  it("never offers an editor a /moderation or /admin link", () => {
    // proxy.ts STAFF_MODERATION_PATH is moderator+admin; STAFF_ADMIN_PATH
    // is admin only. Either link would 404 for an editor.
    const paths = hrefs("editor");
    expect(paths.some((p) => p.startsWith("/moderation"))).toBe(false);
    expect(paths.some((p) => p.startsWith("/admin"))).toBe(false);
    expect(paths).toContain("/editorial");
  });

  it("never offers a moderator an /editorial or /admin link", () => {
    const paths = hrefs("moderator");
    expect(paths.some((p) => p.startsWith("/editorial"))).toBe(false);
    expect(paths.some((p) => p.startsWith("/admin"))).toBe(false);
    expect(paths).toContain("/moderation");
  });

  it("gives a moderator their own review surfaces, not just the overview", () => {
    expect(hrefs("moderator")).toEqual([
      "/moderation",
      "/moderation/stories",
      "/moderation/reports",
      "/readiness",
    ]);
  });

  it("gives an admin the union, because proxy.ts lets admin onto all four", () => {
    expect(hrefs("admin")).toEqual([
      "/admin",
      "/admin/users",
      "/moderation",
      "/editorial",
      "/readiness",
    ]);
  });

  it("offers /readiness to every staff role and to nobody else", () => {
    // STAFF_READINESS_PATH is editor + moderator + admin.
    for (const role of ["editor", "moderator", "admin"] as const) {
      expect(hrefs(role)).toContain("/readiness");
    }
    expect(hrefs("user")).not.toContain("/readiness");
    expect(hrefs(null)).not.toContain("/readiness");
  });

  it("labels every item, so no menu entry renders blank", () => {
    for (const role of ["editor", "moderator", "admin"] as const) {
      for (const item of staffMenuItemsForRole(role)) {
        expect(item.label.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
