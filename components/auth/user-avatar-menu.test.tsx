import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Same "use server" / server-only incompatibility jsdom has everywhere else:
// the dropdown's sign-out button imports the real server action module.
vi.mock("@/app/(auth)/actions", () => ({
  signOutAction: vi.fn(),
}));

import { UserAvatarMenu } from "./user-avatar-menu";

function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: "Account menu" }));
}

describe("UserAvatarMenu", () => {
  it("gives a contributor the authoring links, Account and Sign out", () => {
    render(<UserAvatarMenu emoji="🥝" role="user" />);
    openMenu();

    expect(
      screen.getByRole("menuitem", { name: "My Stories" }),
    ).toHaveAttribute("href", "/my-stories");
    expect(screen.getByRole("menuitem", { name: "New Story" })).toHaveAttribute(
      "href",
      "/stories/new",
    );
    expect(screen.getByRole("menuitem", { name: "Account" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
  });

  // A staff account reviews other people's stories rather than writing its
  // own, so the two authoring links are noise in their menu -- what's left
  // is their role's own surfaces plus Account/Sign out.
  it.each(["moderator", "editor", "admin"] as const)(
    "drops My Stories / New Story for a %s",
    (role) => {
      render(<UserAvatarMenu emoji="🥝" role={role} />);
      openMenu();

      expect(screen.queryByRole("menuitem", { name: "My Stories" })).toBeNull();
      expect(screen.queryByRole("menuitem", { name: "New Story" })).toBeNull();
      expect(screen.getByRole("menuitem", { name: "Account" })).toBeVisible();
      expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
    },
  );

  it("still shows each staff role its own surfaces", () => {
    render(<UserAvatarMenu emoji="🥝" role="moderator" />);
    openMenu();

    expect(
      screen.getByRole("menuitem", { name: "Stories to review" }),
    ).toHaveAttribute("href", "/moderation/stories");
    // Not an editor's surface -- see lib/auth/staff-menu.ts.
    expect(screen.queryByRole("menuitem", { name: "Editorial" })).toBeNull();
  });

  it("treats an unknown role as an ordinary contributor", () => {
    render(<UserAvatarMenu emoji={null} />);
    openMenu();

    expect(screen.getByRole("menuitem", { name: "My Stories" })).toBeVisible();
  });
});
