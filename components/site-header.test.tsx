import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

const { usePathnameMock, sessionMock } = vi.hoisted(() => ({
  usePathnameMock: vi.fn(() => "/"),
  // Mutable so a test can flip the header into its signed-in state; reset
  // to null (signed out) in beforeEach.
  sessionMock: { current: null as { user: { id: string } } | null },
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

// Same "use server" / server-only jsdom incompatibility as above --
// components/auth/user-avatar-menu.tsx imports signOutAction directly for
// its dropdown's sign-out button.
vi.mock("@/app/(auth)/actions", () => ({
  signOutAction: vi.fn(),
}));

// The real browser client needs NEXT_PUBLIC_SUPABASE_URL/KEY, which aren't
// loaded into process.env under Vitest (unlike Next's own dev/build, which
// inlines them) -- so this stands in for it, returning whatever session
// `sessionMock.current` holds (null = signed out, the default).
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: () =>
        Promise.resolve({ data: { session: sessionMock.current } }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
    from: () => ({
      select: () => ({
        // The header reads two of its OWN rows: profiles.avatar_emoji via
        // single(), user_roles.role via maybeSingle() (an account with no
        // role row is an ordinary contributor, not an error). Both resolve
        // empty here -- these tests are about the nav, not the avatar.
        eq: () => ({
          single: () => Promise.resolve({ data: null }),
          maybeSingle: () => Promise.resolve({ data: null }),
        }),
      }),
    }),
  }),
}));

import { SiteHeader } from "./site-header";

beforeEach(() => {
  usePathnameMock.mockReturnValue("/");
  sessionMock.current = null;
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
  // The transparent-over-hero state is gone: the home hero is now an inset
  // plate that starts below the header, so there is no photo to sit over and a
  // transparent header would have drawn white nav text onto the light page
  // ground. These assert it cannot come back by accident.
  it("is solid on the home route, unscrolled", () => {
    render(<SiteHeader />);
    expect(getHeader()).toHaveClass("journiq-header-solid");
    expect(getHeader()).not.toHaveClass("journiq-header");
    expect(getHeader()).not.toHaveClass("text-white");
  });

  it("is solid on every other route too", () => {
    usePathnameMock.mockReturnValue("/sign-in");
    render(<SiteHeader />);
    expect(getHeader()).toHaveClass("journiq-header-solid");
    expect(getHeader()).not.toHaveClass("journiq-header");
  });

  it("stays solid after scrolling on the home route", () => {
    render(<SiteHeader />);

    Object.defineProperty(window, "scrollY", {
      value: 100,
      configurable: true,
    });
    fireEvent.scroll(window);

    expect(getHeader()).toHaveClass("journiq-header-solid");
    expect(getHeader()).not.toHaveClass("journiq-header");
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
    // Not merely hidden: AuthModal mounts its children only while open, so
    // the real SignInForm's id="email"/id="password" fields never duplicate
    // the ones on the real /sign-in page. See auth-modal.tsx's comment.
    expect(screen.queryByText("sign-in-form")).toBeNull();

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

  it("keeps My Stories / New Story out of the public nav bar when signed in", async () => {
    sessionMock.current = { user: { id: "user-1" } };
    render(<SiteHeader />);

    // The avatar replaces the signed-out buttons once the session resolves.
    // Two render (the md:flex desktop cluster and the md:hidden mobile one);
    // jsdom applies no CSS, so both are in the tree -- the desktop one is
    // first in document order.
    const avatars = await screen.findAllByRole("button", {
      name: "Account menu",
    });
    expect(avatars).toHaveLength(2);
    expect(
      screen.queryByRole("button", { name: "Sign in" }),
    ).not.toBeInTheDocument();

    // No second "Contributor" nav bar alongside Primary -- those two links
    // belong to the (contributor) routes' own header, not this one.
    expect(
      screen.queryByRole("navigation", { name: "Contributor" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "My Stories" })).toBeNull();
    expect(screen.queryByRole("link", { name: "New Story" })).toBeNull();

    // They are still one click away, inside the profile icon's dropdown.
    fireEvent.click(avatars[0]);
    expect(
      screen.getByRole("menuitem", { name: "My Stories" }),
    ).toHaveAttribute("href", "/my-stories");
    expect(screen.getByRole("menuitem", { name: "New Story" })).toHaveAttribute(
      "href",
      "/stories/new",
    );
  });

  it("closes the modal via its close button", () => {
    render(<SiteHeader />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByText("sign-in-form")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    // Unmounted, not just hidden — same reasoning as the open test above.
    expect(screen.queryByText("sign-in-form")).toBeNull();
  });
});
