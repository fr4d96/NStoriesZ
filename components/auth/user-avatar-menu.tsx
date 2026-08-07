"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { signOutAction } from "@/app/(auth)/actions";
import { ContributorIcon } from "@/components/icons";
import { controlToneClasses } from "@/components/ui-tone";

const menuItems = [
  { href: "/my-stories", label: "My Stories" },
  { href: "/account", label: "Account" },
  { href: "/stories/new", label: "New Story" },
];

/**
 * Replaces the signed-in "My Stories / Account / New Story / Sign out"
 * button row with a single avatar that opens a dropdown holding those same
 * four actions -- the avatar itself is the emoji chosen on /account
 * (lib/avatar.ts's pre-loaded set), falling back to a generic person icon
 * for accounts that haven't picked one yet.
 */
export function UserAvatarMenu({
  emoji,
  inverted = false,
}: {
  emoji: string | null;
  inverted?: boolean;
}) {
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
          className="absolute right-0 top-12 z-50 w-48 rounded-xl border border-border-subtle bg-surface p-1.5 text-foreground shadow-xl"
        >
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
