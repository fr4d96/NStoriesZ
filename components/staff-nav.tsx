import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { UserAvatarMenu } from "@/components/auth/user-avatar-menu";
import { NotificationBell } from "@/components/notifications/notification-bell";
import type { AppRole } from "@/lib/auth/staff-guard";

/**
 * The shared header for every staff dashboard -- moderation, editorial,
 * admin, readiness. Each of those had its own copy of the same markup, and
 * so had four copies of the same mobile bug: the title and a four-link nav
 * competed for one row on a phone, so the links wrapped INTO the title
 * ("Kakinotes — Moderation" with "Overview / Stories queue / Reports"
 * stacked on top of it at 375px). Two of the four didn't wrap at all and
 * simply overflowed sideways.
 *
 * The fix is one row order, expressed once. Below `sm` the nav is forced to
 * its own full-width second row (`order-3 w-full`), leaving row one as
 * title + avatar -- nothing overlaps because nothing shares the row it
 * can't fit in. From `sm` the nav is `w-auto` again and reordered back
 * between them, which is the desktop layout these headers already had.
 *
 * Presentational only: each route group's own nav component still does its
 * own server-side role check and data fetching before rendering this. The
 * `role` passed through to UserAvatarMenu is likewise for drawing the menu,
 * never for authorizing anything -- see lib/auth/staff-menu.ts.
 */
export function StaffNav({
  title,
  label,
  links,
  avatarEmoji,
  role,
}: {
  title: string;
  /** aria-label for the <nav> -- "Moderation", "Editorial", etc. */
  label: string;
  links: { href: string; label: string }[];
  avatarEmoji: string | null;
  role: AppRole | null;
}) {
  return (
    <header className="border-b border-border-subtle">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-3 px-4 py-4 sm:flex-nowrap sm:px-6">
        {/* The logo sits beside the wordmark here for the same reason it does
            in site-header, contributor-nav and site-footer: these four staff
            dashboards were the only place the brand appeared as bare text.
            alt="" is deliberate -- the wordmark is right beside it, so a
            screen reader announcing both would just say it twice. */}
        <Link
          href="/"
          className="mr-auto flex items-center gap-2.5 text-lg font-semibold tracking-tight"
        >
          <BrandLogo className="border border-border-subtle" />
          {title}
        </Link>
        <nav
          aria-label={label}
          className="order-3 flex w-full flex-wrap items-center gap-x-4 gap-y-1 text-sm sm:order-1 sm:w-auto sm:flex-nowrap sm:gap-6"
        >
          {links.map((item) => (
            <Link key={item.href} href={item.href} className="hover:underline">
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="order-2 flex shrink-0 items-center gap-2 sm:order-2">
          <NotificationBell />
          <UserAvatarMenu emoji={avatarEmoji} role={role} />
        </div>
      </div>
    </header>
  );
}
