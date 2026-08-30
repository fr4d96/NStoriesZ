"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { MobileNavToggle } from "@/components/mobile-nav-toggle";
import { ThemeToggle } from "@/components/theme-toggle";
import { AuthModal } from "@/components/auth/auth-modal";
import { SignInForm } from "@/components/auth/sign-in-form";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { UserAvatarMenu } from "@/components/auth/user-avatar-menu";
import { createClient } from "@/lib/supabase/client";
import type { AppRole } from "@/lib/auth/staff-guard";

// "Destinations" is a home-page anchor and must match the section id in
// app/(public)/page.tsx. "Stories" and "Contributors" link to their own
// real browsing pages rather than sections on the home page.
const primaryNav = [
  { href: "/stories", label: "Stories" },
  { href: "/contributors", label: "Contributors" },
  { href: "/#match", label: "Destinations" },
  { href: "/about", label: "About" },
];

type AuthModalKind = "sign-in" | "sign-up" | null;

/**
 * Shared across every public and auth route ((public)/layout.tsx AND
 * (auth)/layout.tsx both render this). The header is ALWAYS a solid themed
 * surface -- there is no transparent-over-hero state.
 *
 * There used to be one, gated on `pathname === "/" && !scrolled`, because
 * the home hero ran full-bleed and tucked itself behind the header with a
 * `-mt-[76px]`. That hero is now an inset plate that starts below the
 * header (see app/(public)/page.tsx), so there is no longer a photo for a
 * transparent header to sit over -- keeping the state would have drawn
 * white nav text straight onto the light page ground. Removing it also
 * removes a scroll listener from every public route and the `inverted`
 * prop threading that went with it.
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
 *
 * That dropdown is the ONLY place My Stories / New Story appear on public
 * pages -- ContributorNavLinks (the always-visible header versions) is
 * rendered by ContributorNav alone, on the (contributor) routes where the
 * visitor is actually authoring. A signed-in visitor browsing public pages
 * is reading, so the public nav bar stays Stories/Destinations/About.
 */
export function SiteHeader() {
  const [authModal, setAuthModal] = useState<AuthModalKind>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [avatarEmoji, setAvatarEmoji] = useState<string | null>(null);
  // Drives ONLY which staff links the dropdown draws -- never access. See
  // lib/auth/staff-menu.ts; proxy.ts re-derives this server-side on every
  // request, so a wrong value here changes nothing but the menu.
  const [role, setRole] = useState<AppRole | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let active = true;

    // Both reads are the caller's OWN row under RLS (profiles' "owner reads
    // own profile" and user_roles' "read own role" -- the latter exists
    // precisely so the app can render role-aware UI, see its migration).
    // maybeSingle(), not single(), because an account with no role row yet
    // is an ordinary contributor, not an error worth logging.
    async function loadIdentity(userId: string) {
      const [profile, roleRow] = await Promise.all([
        supabase
          .from("profiles")
          .select("avatar_emoji")
          .eq("id", userId)
          .single(),
        supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", userId)
          .maybeSingle(),
      ]);
      if (!active) return;
      setAvatarEmoji(profile.data?.avatar_emoji ?? null);
      setRole((roleRow.data?.role as AppRole | undefined) ?? null);
    }

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSignedIn(!!data.session);
      if (data.session) loadIdentity(data.session.user.id);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!active) return;
        setSignedIn(!!session);
        if (session) {
          loadIdentity(session.user.id);
        } else {
          setAvatarEmoji(null);
          setRole(null);
        }
      },
    );

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  // shadow-sm resolves to the themed elevation ramp: a soft lift in light,
  // where the bar shares --background with the page and a hairline alone
  // barely separates it, and near-nothing in dark, where it already does.
  const headerToneClasses =
    "journiq-header-solid border-b border-border-subtle text-foreground shadow-sm";
  const signInToneClasses = "border-border-subtle";

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
          <div className="flex items-center gap-6">
            {primaryNav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="journiq-nav-link"
              >
                {item.label}
              </Link>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            {signedIn ? (
              <UserAvatarMenu emoji={avatarEmoji} role={role} />
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
        </nav>

        <div className="ml-auto flex items-center gap-2 md:hidden">
          <ThemeToggle />
          {signedIn ? (
            // Replaces the hamburger entirely on mobile once signed in --
            // its dropdown carries the primary nav links too (extraItems),
            // so nothing from the old hamburger menu is lost.
            <UserAvatarMenu
              emoji={avatarEmoji}
              extraItems={primaryNav}
              role={role}
            />
          ) : (
            <MobileNavToggle
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
