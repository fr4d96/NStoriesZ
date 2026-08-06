import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

const { usePathnameMock } = vi.hoisted(() => ({
  usePathnameMock: vi.fn(() => "/"),
}));
vi.mock("next/navigation", () => ({
  usePathname: usePathnameMock,
}));

// The real SignInForm/SignUpForm transitively import their "use server"
// action module, which in turn imports lib/supabase/server.ts's
// server-only guard -- fine in a real Next.js build (the "use server"
// directive gets specially compiled away for client bundles), but jsdom
// looks enough like a browser that the server-only package throws on
// import here. SiteHeader's own tests don't need the real forms -- those
// are covered by components/auth/auth-modal.test.tsx and the forms'
// own behavior is exercised on the real /sign-in and /sign-up pages.
vi.mock("@/components/auth/sign-in-form", () => ({
  SignInForm: () => <div>sign-in-form</div>,
}));
vi.mock("@/components/auth/sign-up-form", () => ({
  SignUpForm: () => <div>sign-up-form</div>,
}));

import { SiteHeader } from "./site-header";

beforeEach(() => {
  usePathnameMock.mockReturnValue("/");
  Object.defineProperty(window, "scrollY", {
    value: 0,
    writable: true,
    configurable: true,
  });
});

function getHeader() {
  return screen.getByRole("banner");
}

describe("SiteHeader", () => {
  it("is transparent (journiq-header) on the home route before scrolling", () => {
    render(<SiteHeader />);
    expect(getHeader()).toHaveClass("journiq-header");
  });

  it("is solid everywhere except the home route, even unscrolled", () => {
    usePathnameMock.mockReturnValue("/sign-in");
    render(<SiteHeader />);
    expect(getHeader()).not.toHaveClass("journiq-header");
    expect(getHeader()).toHaveClass("bg-surface");
  });

  it("switches from transparent to solid once scrolled past the threshold on the home route", () => {
    render(<SiteHeader />);
    expect(getHeader()).toHaveClass("journiq-header");

    Object.defineProperty(window, "scrollY", {
      value: 100,
      configurable: true,
    });
    fireEvent.scroll(window);

    expect(getHeader()).not.toHaveClass("journiq-header");
    expect(getHeader()).toHaveClass("bg-surface");
  });

  it("always renders the real primary nav destinations", () => {
    render(<SiteHeader />);
    expect(screen.getByRole("link", { name: "About" })).toHaveAttribute(
      "href",
      "/about",
    );
  });

  it("opens the sign-in modal from the header button instead of navigating", () => {
    render(<SiteHeader />);
    expect(screen.getByText("sign-in-form")).not.toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      screen.getByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
    expect(screen.getByText("sign-in-form")).toBeInTheDocument();
  });

  it("opens the sign-up modal from the 'Share your story' button", () => {
    render(<SiteHeader />);

    fireEvent.click(screen.getByRole("button", { name: "Share your story" }));

    expect(
      screen.getByRole("heading", { name: "Create your account" }),
    ).toBeInTheDocument();
    expect(screen.getByText("sign-up-form")).toBeInTheDocument();
  });

  it("closes the modal via its close button", () => {
    render(<SiteHeader />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByText("sign-in-form")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.queryByText("sign-in-form")).not.toBeVisible();
  });
});
