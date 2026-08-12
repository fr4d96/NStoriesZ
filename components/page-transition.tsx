"use client";

import { usePathname } from "next/navigation";

/**
 * Subtle fade/rise on every route change -- keyed by pathname so React
 * remounts (and thus re-plays the CSS animation on) exactly this wrapper,
 * never the header/nav around it. Respects prefers-reduced-motion via the
 * global `*` override in app/globals.css, so no extra guard is needed here.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="journiq-page-transition">
      {children}
    </div>
  );
}
