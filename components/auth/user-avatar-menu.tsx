"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { signOutAction } from "@/app/(auth)/actions";
import { ContributorIcon } from "@/components/icons";
import { controlToneClasses } from "@/components/ui-tone";
import type { AppRole } from "@/lib/auth/staff-guard";
import { staffMenuItemsForRole } from "@/lib/auth/staff-menu";

const menuItems = [
  { href: "/my-stories", label: "My Stories" },
  { href: "/stories/new", label: "New Story" },
  { href: "/account", label: "Account" },
];

/**
 * The single, always-present profile icon: every signed-in header
 * (SiteHeader, ContributorNav, ModerationNav, EditorialNav, ReadinessNav)
 * renders this instead of its own ad hoc sign-out/account links, so the
 * same actions are reachable the same way regardless of which screen is
 * showing. Opens a dropdown with, in order: My Stories, New Story, Account,
 * Sign out -- the avatar itself is the emoji chosen on /account
 * (lib/avatar.ts's pre-loaded set), falling back to a generic person icon
 * for accounts that haven't picked one yet.
 *
 * `extraItems` is for a header's own links that don't belong in the shared
 * menu (e.g. SiteHeader's mobile placement, where this avatar replaces the
 * hamburger entirely and so also has to carry the public primary nav).
 * Omitted wherever a header already has its own always-visible nav bar for
 * those links.
 *
 * `role` adds the caller's own staff surfaces as a separate top group --
 * a moderator gets Stories to review / Reader reports, an editor gets the
 * editorial queue, an admin gets all of it. Every header passes it, because
 * the point is that a staff member browsing a PUBLIC page or a contributor
 * page has no other route back to their dashboard; being consistent on the
 * staff headers too means the same switcher is in the same place on every
 * screen.
 *
 * The role here is PRESENTATION ONLY and is never an authorization input --
 * see lib/auth/staff-menu.ts. proxy.ts, each route group's layout, and RLS
 * each re-derive it server-side, so a link rendered in error still leads to
 * a flat 404.
 */
export function UserAvatarMenu({
  emoji,
  inverted = false,
  extraItems,
  role,
}: {
  emoji: string | null;
  inverted?: boolean;
  extraItems?: { href: string; label: string }[];
  role?: AppRole | null;
}) {
  const staffItems = staffMenuItemsForRole(role ?? null);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label="Account menu"
        className={`flex h-10 w-10 items-center justify-center rounded-full border text-lg transition-transform hover:-translate-y-0.5 ${controlToneClasses(inverted)}`}
      >
        {emoji ?? <ContributorIcon className="h-5 w-5" />}
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          className="absolute right-0 top-12 z-50 max-h-[calc(100vh-5rem)] w-56 overflow-y-auto rounded-xl border border-border-subtle bg-surface p-1.5 text-foreground shadow-xl"
        >
          {staffItems.length > 0 && (
            <>
              {/*
                Labelled, because "Moderation" sitting directly above "My
                Stories" reads as one flat list of unrelated places. The
                heading is what makes the group legible as "your staff
                surfaces" rather than more account actions.
              */}
              <p className="px-3 pt-1.5 pb-1 font-mono text-[0.625rem] tracking-[0.14em] text-muted-foreground uppercase">
                Staff
              </p>
              {staffItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className="block rounded-lg px-3 py-2 text-sm font-medium hover:bg-surface-muted"
                >
                  {item.label}
                </Link>
              ))}
              <div className="my-1 border-t border-border-subtle" />
            </>
          )}
          {extraItems && extraItems.length > 0 && (
            <>
              {extraItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className="block rounded-lg px-3 py-2 text-sm font-medium hover:bg-surface-muted"
                >
                  {item.label}
                </Link>
              ))}
              <div className="my-1 border-t border-border-subtle" />
            </>
          )}
          {menuItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block rounded-lg px-3 py-2 text-sm font-medium hover:bg-surface-muted"
            >
              {item.label}
            </Link>
          ))}
          <form action={signOutAction}>
            <button
              type="submit"
              role="menuitem"
              className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium hover:bg-surface-muted"
            >
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
