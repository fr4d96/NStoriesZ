"use client";

import { useId, useState } from "react";
import Link from "next/link";

type NavItem = { href: string; label: string };

/**
 * Only the open/close state is client-side. Keyboard operable: a real
 * <button> with aria-expanded/aria-controls, closes on Escape.
 */
export function MobileNavToggle({ navItems }: { navItems: NavItem[] }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();

  return (
    <div className="sm:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
        className="rounded-md border border-black/20 px-3 py-1.5 text-sm dark:border-white/20"
      >
        {open ? "Close" : "Menu"}
      </button>

      {open ? (
        <nav
          id={menuId}
          aria-label="Primary"
          className="absolute inset-x-0 top-full z-40 border-b border-black/10 bg-white px-4 py-4 dark:border-white/10 dark:bg-black"
        >
          <ul className="flex flex-col gap-3 text-sm">
            {navItems.map((item) => (
              <li key={item.href}>
                <Link href={item.href} onClick={() => setOpen(false)}>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </div>
  );
}
