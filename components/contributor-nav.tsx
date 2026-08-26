import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserAvatarMenu } from "@/components/auth/user-avatar-menu";
import { ContributorNavLinks } from "@/components/contributor-nav-links";
import {
  getCurrentUserAvatarEmoji,
  getCurrentUserRole,
} from "@/lib/auth/roles";

/**
 * Rendered only inside the (contributor) layout, after the real session
 * check passes — deliberately separate from the public SiteHeader (never a
 * contradictory "Sign in" link for a signed-in user), but styled to match
 * it: same solid-header treatment and logo mark (see app/globals.css
 * .journiq-header-solid), since this is the same site, just past the
 * sign-in wall. The profile icon (UserAvatarMenu) is the one place My
 * Stories/New Story/Account/Sign out live -- same menu, same order, on
 * every signed-in header in the app, not just this one. A Server Component
 * (like ModerationNav/EditorialNav/ReadinessNav) so it can read the
 * caller's own avatar directly, rather than needing every layout above it
 * to fetch and pass it down.
 */
export async function ContributorNav() {
  const [avatarEmoji, role] = await Promise.all([
    getCurrentUserAvatarEmoji(),
    getCurrentUserRole(),
  ]);

  return (
    <header className="journiq-header-solid sticky top-0 z-40 border-b border-border-subtle text-foreground">
      <div className="mx-auto flex min-h-[76px] max-w-[1440px] items-center gap-5 px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2.5 text-xl font-black tracking-tight"
        >
          <BrandLogo className="border border-current" />
          Kakinotes
        </Link>

        <ContributorNavLinks className="ml-auto hidden md:flex" />

        <div className="ml-auto flex items-center gap-2 md:ml-0">
          <ThemeToggle />
          <UserAvatarMenu emoji={avatarEmoji} role={role} />
        </div>
      </div>
    </header>
  );
}
