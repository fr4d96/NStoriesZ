"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MobileNavToggle } from "@/components/mobile-nav-toggle";
import { ThemeToggle } from "@/components/theme-toggle";
import { AuthModal } from "@/components/auth/auth-modal";
import { SignInForm } from "@/components/auth/sign-in-form";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { useSyncedBoolean } from "@/lib/hooks/use-synced-boolean";

const primaryNav = [
  { href: "/#stories", label: "Stories" },
  { href: "/#regions", label: "Destinations" },
  { href: "/#how", label: "Work Guides" },
  { href: "/about", label: "About" },
];

const SCROLL_THRESHOLD = 24;

type AuthModalKind = "sign-in" | "sign-up" | null;

/**
 * Shared across every public and auth route ((public)/layout.tsx AND
 * (auth)/layout.tsx both render this) -- only the home page has a photo
 * hero behind it, so the transparent-over-hero treatment is gated on both
 * the route (usePathname() === "/") and scroll position, not applied
 * unconditionally. Everywhere else -- and on home once scrolled past the
 * hero -- it's a normal solid header. The header's own box never changes
 * size when toggling (no negative margin here); the home page's hero
 * section supplies its own `-mt-[76px]` to tuck in behind the header
 * instead, so switching from transparent to solid never causes a layout
 * jump.
 *
 * "Sign in" and "Share your story" open a modal (components/auth/auth-modal.tsx)
 * wrapping the same SignInForm/SignUpForm the real /sign-in and /sign-up
 * pages use -- no auth logic is duplicated. Those routes still exist and
 * work standalone (direct navigation, bookmarks, and the auth middleware's
 * own redirects all still land on a real page); this only changes what the
 * header's own buttons do. A successful sign-in still calls redirect() from
 * the server action as before, which navigates the whole page away and
 * closes the modal as a side effect -- closing it any other way (Escape,
 * backdrop click, the × button) just returns to whatever page was open
 * underneath.
 */
export function SiteHeader() {
  const pathname = usePathname();
  const scrolled = useSyncedBoolean(
    (callback) => {
      window.addEventListener("scroll", callback, { passive: true });
      return () => window.removeEventListener("scroll", callback);
    },
    () => window.scrollY > SCROLL_THRESHOLD,
  );
  const transparent = pathname === "/" && !scrolled;
  const [authModal, setAuthModal] = useState<AuthModalKind>(null);

  const headerToneClasses = transparent
    ? "journiq-header text-white"
    : "border-b border-border-subtle bg-surface text-foreground";
  const signInToneClasses = transparent
    ? "border-white/60"
    : "border-border-subtle";

  return (
    <header
      className={`sticky top-0 z-40 transition-colors ${headerToneClasses}`}
    >
      <div className="mx-auto flex min-h-[76px] max-w-[1160px] items-center gap-5 px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2.5 text-xl font-black tracking-tight"
        >
          <span className="grid h-9 w-9 -rotate-12 place-items-center rounded-full border border-current">
            ↗
          </span>
          Journiq
        </Link>

        <nav
          aria-label="Primary"
          className="ml-auto hidden items-center gap-6 text-sm font-bold md:flex"
        >
          {primaryNav.map((item) => (
            <Link key={item.href} href={item.href} className="journiq-nav-link">
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <ThemeToggle inverted={transparent} />
          <button
            type="button"
            onClick={() => setAuthModal("sign-in")}
            className={`rounded-full border px-4 py-2 text-sm font-bold ${signInToneClasses}`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => setAuthModal("sign-up")}
            className="rounded-full bg-accent px-4 py-2 text-sm font-black text-accent-foreground"
          >
            Share your story
          </button>
        </div>

        <div className="ml-auto flex items-center gap-2 md:hidden">
          <ThemeToggle inverted={transparent} />
          <MobileNavToggle
            inverted={transparent}
            navItems={[
              ...primaryNav,
              { label: "Sign in", onClick: () => setAuthModal("sign-in") },
              {
                label: "Share your story",
                onClick: () => setAuthModal("sign-up"),
              },
            ]}
          />
        </div>
      </div>

      <AuthModal
        open={authModal === "sign-in"}
        onClose={() => setAuthModal(null)}
        title="Sign in"
      >
        <SignInForm next="/account" />
      </AuthModal>
      <AuthModal
        open={authModal === "sign-up"}
        onClose={() => setAuthModal(null)}
        title="Create your account"
      >
        <SignUpForm />
      </AuthModal>
    </header>
  );
}
