"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { controlToneClasses } from "@/components/ui-tone";

// Either a real navigable link, or an action item (e.g. "open the sign-in
// modal") -- distinguished by which of href/onClick is present, never both.
type NavItem =
  | { label: string; href: string; onClick?: never }
  | { label: string; href?: never; onClick: () => void };

/**
 * Only the open/close state is client-side. Keyboard operable: a real
 * <button> with aria-expanded/aria-controls, closes on Escape.
 *
 * The `md:hidden` breakpoint here must match whatever breakpoint the
 * caller's own desktop nav uses to hide itself (currently `md:flex` in
 * components/site-header.tsx) -- otherwise there's a dead viewport range
 * where neither nav is visible.
 */
export function MobileNavToggle({
  navItems,
  inverted = false,
}: {
  navItems: NavItem[];
  inverted?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const toggleToneClasses = controlToneClasses(inverted);

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
        className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${toggleToneClasses}`}
      >
        {open ? "Close" : "Menu"}
      </button>

      {open ? (
        <nav
          id={menuId}
          aria-label="Primary"
          className="absolute inset-x-0 top-full z-40 border-b border-border-subtle bg-surface px-4 py-4 text-foreground"
        >
          <ul className="flex flex-col gap-3 text-sm">
            {navItems.map((item) => {
              // Captured outside the closures below so TS's narrowing of
              // item.href/item.onClick (which doesn't reliably survive
              // property access inside a nested arrow function) isn't
              // needed -- these are plain locals instead.
              const href = item.href;
              const onItemClick = item.onClick;
              return (
                <li key={item.label}>
                  {href ? (
                    <Link href={href} onClick={() => setOpen(false)}>
                      {item.label}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      className="text-left"
                      onClick={() => {
                        setOpen(false);
                        onItemClick?.();
                      }}
                    >
                      {item.label}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}
    </div>
  );
}
