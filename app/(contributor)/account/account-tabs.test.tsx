import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { AccountTabs, type AccountTab } from "./account-tabs";

const tabs: AccountTab[] = [
  {
    id: "profile",
    label: "Profile",
    description: "Profile description",
    panel: <p>profile panel</p>,
  },
  {
    id: "sign-in",
    label: "Sign-in",
    description: "Sign-in description",
    panel: <p>sign-in panel</p>,
  },
  {
    id: "contributor-identity",
    label: "Contributor identity",
    description: "Contributor description",
    panel: <p>contributor panel</p>,
  },
];

function tab(name: string) {
  return screen.getByRole("tab", { name, hidden: true });
}

beforeEach(() => {
  window.history.replaceState(null, "", "/account");
});

describe("AccountTabs", () => {
  it("selects the first tab by default and hides the others", () => {
    render(<AccountTabs tabs={tabs} />);

    expect(tab("Profile")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("profile panel")).toBeVisible();
    expect(screen.getByText("sign-in panel")).not.toBeVisible();
    expect(screen.getByText("contributor panel")).not.toBeVisible();
  });

  it("keeps every panel mounted so unsaved edits survive a tab switch", () => {
    // Only safe because the three real forms use distinct field ids -- see
    // the component's header comment. If they ever collide, this has to
    // become unmount-when-inactive.
    render(<AccountTabs tabs={tabs} />);
    expect(screen.getByText("contributor panel")).toBeInTheDocument();
  });

  it("switches panels on click", () => {
    render(<AccountTabs tabs={tabs} />);

    fireEvent.click(tab("Sign-in"));

    expect(tab("Sign-in")).toHaveAttribute("aria-selected", "true");
    expect(tab("Profile")).toHaveAttribute("aria-selected", "false");
    expect(screen.getByText("sign-in panel")).toBeVisible();
    expect(screen.getByText("profile panel")).not.toBeVisible();
  });

  it("gives each panel its tab's id, so /account#<id> is a real anchor", () => {
    render(<AccountTabs tabs={tabs} />);

    for (const t of tabs) {
      const panel = document.getElementById(t.id);
      expect(panel).not.toBeNull();
      expect(panel).toHaveAttribute("role", "tabpanel");
      expect(panel).toHaveAttribute("aria-labelledby", `tab-${t.id}`);
      expect(tab(t.label)).toHaveAttribute("aria-controls", t.id);
    }
  });

  it("opens the tab named in the URL hash on mount", () => {
    // lib/auth/post-login-redirect.ts sends every brand-new account to
    // /account#contributor-identity on its first sign-in. If this breaks,
    // that landing silently shows the wrong tab.
    window.history.replaceState(null, "", "/account#contributor-identity");
    render(<AccountTabs tabs={tabs} />);

    expect(tab("Contributor identity")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("contributor panel")).toBeVisible();
  });

  it("ignores a hash that does not name a tab", () => {
    window.history.replaceState(null, "", "/account#nonsense");
    render(<AccountTabs tabs={tabs} />);

    expect(tab("Profile")).toHaveAttribute("aria-selected", "true");
  });

  it("opens a tab when an in-page link changes the hash", () => {
    // The "Set it up" banner is a plain <a href="#contributor-identity"> in
    // the Server Component, so hashchange is the only way it can reach here.
    render(<AccountTabs tabs={tabs} />);
    expect(tab("Profile")).toHaveAttribute("aria-selected", "true");

    act(() => {
      window.history.replaceState(null, "", "/account#contributor-identity");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });

    expect(tab("Contributor identity")).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("writes the active tab back to the hash", () => {
    render(<AccountTabs tabs={tabs} />);

    fireEvent.click(tab("Contributor identity"));

    expect(window.location.hash).toBe("#contributor-identity");
  });

  it("uses a roving tabindex so the tablist is one tab stop", () => {
    render(<AccountTabs tabs={tabs} />);

    expect(tab("Profile")).toHaveAttribute("tabindex", "0");
    expect(tab("Sign-in")).toHaveAttribute("tabindex", "-1");
    expect(tab("Contributor identity")).toHaveAttribute("tabindex", "-1");
  });

  it("moves between tabs with either axis of arrow keys", () => {
    // The same tablist is vertical on desktop and horizontal on mobile, so
    // both axes have to work -- a keyboard user should not have to know
    // which layout they are looking at.
    render(<AccountTabs tabs={tabs} />);

    fireEvent.keyDown(tab("Profile"), { key: "ArrowDown" });
    expect(tab("Sign-in")).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(tab("Sign-in"), { key: "ArrowRight" });
    expect(tab("Contributor identity")).toHaveAttribute(
      "aria-selected",
      "true",
    );

    fireEvent.keyDown(tab("Contributor identity"), { key: "ArrowUp" });
    expect(tab("Sign-in")).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(tab("Sign-in"), { key: "ArrowLeft" });
    expect(tab("Profile")).toHaveAttribute("aria-selected", "true");
  });

  it("wraps around at both ends", () => {
    render(<AccountTabs tabs={tabs} />);

    fireEvent.keyDown(tab("Profile"), { key: "ArrowUp" });
    expect(tab("Contributor identity")).toHaveAttribute(
      "aria-selected",
      "true",
    );

    fireEvent.keyDown(tab("Contributor identity"), { key: "ArrowDown" });
    expect(tab("Profile")).toHaveAttribute("aria-selected", "true");
  });

  it("jumps to the first and last tab with Home and End", () => {
    render(<AccountTabs tabs={tabs} />);

    fireEvent.keyDown(tab("Profile"), { key: "End" });
    expect(tab("Contributor identity")).toHaveAttribute(
      "aria-selected",
      "true",
    );

    fireEvent.keyDown(tab("Contributor identity"), { key: "Home" });
    expect(tab("Profile")).toHaveAttribute("aria-selected", "true");
  });

  it("moves focus with the keyboard, but not on a plain click", () => {
    render(<AccountTabs tabs={tabs} />);

    fireEvent.keyDown(tab("Profile"), { key: "ArrowDown" });
    expect(tab("Sign-in")).toHaveFocus();
  });

  it("leaves other keys alone", () => {
    render(<AccountTabs tabs={tabs} />);

    fireEvent.keyDown(tab("Profile"), { key: "a" });
    expect(tab("Profile")).toHaveAttribute("aria-selected", "true");
  });
});
