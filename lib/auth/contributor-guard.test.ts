import { describe, expect, it } from "vitest";
import { resolveContributorAccess } from "./contributor-guard";

describe("resolveContributorAccess", () => {
  it("redirects to /sign-in when there is no current user", () => {
    const result = resolveContributorAccess(null);

    expect(result).toEqual({ ok: false, redirectTo: "/sign-in" });
  });

  it("grants access and passes through the user when signed in", () => {
    const user = { id: "11111111-1111-1111-1111-111111111111" };

    const result = resolveContributorAccess(user);

    expect(result).toEqual({ ok: true, user });
  });
});
