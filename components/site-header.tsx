"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandLogo } from "@/components/brand-logo";
import { MobileNavToggle } from "@/components/mobile-nav-toggle";
import { ThemeToggle } from "@/components/theme-toggle";
import { AuthModal } from "@/components/auth/auth-modal";
import { SignInForm } from "@/components/auth/sign-in-form";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { UserAvatarMenu } from "@/components/auth/user-avatar-menu";
import { ContributorNavLinks } from "@/components/contributor-nav-links";
import { useSyncedBoolean } from "@/lib/hooks/use-synced-boolean";
import { createClient } from "@/lib/supabase/client";

// Home-page anchors must match the section ids in app/(public)/page.tsx.
const primaryNav = [
  { href: "/#index", label: "Storiesss" },
  { href: "/#match", label: "Destinations" },
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
 *
 * Session awareness: public pages deliberately never call getCurrentUser()
 * server-side (see (contributor)/layout.tsx's own comment) so they stay
 * static/cache-friendly -- this header is the one place that still needs
 * to know if the visitor is signed in, so it checks client-side only, via
 * the browser Supabase client (lib/supabase/client.ts). That keeps every
 * public page's server-rendered HTML untouched; only this already-client
 * component re-renders once the check resolves.
 *
 * Once signed in, the same effect also reads the caller's own
 * profiles.avatar_emoji (RLS already scopes this to auth.uid() -- see
 * that table's "owner reads own profile" policy) to feed
 * components/auth/user-avatar-menu.tsx, which replaces the whole
 * My Stories/Account/New Story/Sign out button row with a single avatar
 * that opens those same four actions in a dropdown.
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
  // Only the home page has a photo hero for the header to sit over. Once
  // scrolled (and on every other route) the header is a normal themed
  // surface -- `--header-solid` and `text-foreground` already resolve per
  // theme, so no route needs a special case.
  const transparent = pathname === "/" && !scrolled;
  const inverted = transparent;
  const [authModal, setAuthModal] = useState<AuthModalKind>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [avatarEmoji, setAvatarEmoji] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let active = true;

    async function loadAvatar(userId: string) {
      const { data } = await supabase
        .from("profiles")
        .select("avatar_emoji")
        .eq("id", userId)
        .single();
      if (active) setAvatarEmoji(data?.avatar_emoji ?? null);
    }

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSignedIn(!!data.session);
      if (data.session) loadAvatar(data.session.user.id);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!active) return;
        setSignedIn(!!session);
        if (session) {
          loadAvatar(session.user.id);
        } else {
          setAvatarEmoji(null);
        }
      },
    );

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const headerToneClasses = transparent
    ? "journiq-header text-white"
    : "journiq-header-solid border-b border-border-subtle text-foreground";
  const signInToneClasses = inverted
    ? "border-white/60"
    : "border-border-subtle";

  return (
    <header
      className={`sticky top-0 z-40 transition-colors ${headerToneClasses}`}
    >
      <div className="mx-auto flex min-h-[76px] max-w-[1440px] items-center gap-5 px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2.5 text-xl font-black tracking-tight"
        >
          <BrandLogo className="border border-current" priority />
          Kakinotes
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

        {signedIn && <ContributorNavLinks className="hidden md:flex" />}

        <div className="hidden items-center gap-2 md:flex">
          <ThemeToggle inverted={inverted} />
          {signedIn ? (
            <UserAvatarMenu emoji={avatarEmoji} inverted={inverted} />
          ) : (
            <>
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
            </>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2 md:hidden">
          <ThemeToggle inverted={inverted} />
          {signedIn ? (
            // Replaces the hamburger entirely on mobile once signed in --
            // its dropdown carries the primary nav links too (extraItems),
            // so nothing from the old hamburger menu is lost.
            <UserAvatarMenu
              emoji={avatarEmoji}
              inverted={inverted}
              extraItems={primaryNav}
            />
          ) : (
            <MobileNavToggle
              inverted={inverted}
              navItems={[
                ...primaryNav,
                { label: "Sign in", onClick: () => setAuthModal("sign-in") },
                {
                  label: "Share your story",
                  onClick: () => setAuthModal("sign-up"),
                },
              ]}
            />
          )}
        </div>
      </div>

      <AuthModal
        open={authModal === "sign-in"}
        onClose={() => setAuthModal(null)}
        title="Sign in"
      >
        {/* Deliberately no "/account" default here -- an empty next tells
            signInAction "nothing specific was requested," so it can land
            staff roles on their own dashboard instead (see
            lib/auth/post-login-redirect.ts). This modal is only ever opened
            from a public page with no protected-route redirect pending, so
            there's never a real next to preserve. */}
        <SignInForm next="" />
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
