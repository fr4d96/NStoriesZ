/**
 * Loading placeholders for route-level `loading.tsx` fallbacks.
 *
 * These replaced a root-level `app/loading.tsx` that rendered the bare word
 * "Loading…". Two things were wrong with it, and both are fixed by where
 * these get used rather than by how they look:
 *
 *   1. It sat at the ROOT segment, above every route group, so React swapped
 *      out the group layout along with the page — header, nav and footer all
 *      vanished on every navigation. The fallbacks that use these components
 *      live INSIDE their route group, nested under that group's layout, so
 *      the chrome stays on screen and only <main> is replaced.
 *   2. It appeared instantly, including for prefetched routes that resolve in
 *      60ms. `.nf-loading` (app/globals.css) holds every fallback at opacity 0
 *      behind a 140ms delay, so a fast navigation paints no loading state at
 *      all.
 *
 * All of the visual treatment — tint, sheen, stagger, the reduced-motion
 * fallback — lives in app/globals.css under "Loading — the focus pull, held".
 * Nothing here sets a colour.
 */

/**
 * One placeholder block. Pass Tailwind utilities for size, aspect and radius;
 * `nf-skeleton` supplies the tint and the sweeping sheen.
 *
 * `aria-hidden` throughout: the shape of a skeleton means nothing to a screen
 * reader, and a grid of twelve of them announced individually is noise. The
 * single "Loading" announcement comes from LoadingScreen below.
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`nf-skeleton ${className}`} />;
}

/**
 * A run of text lines. The last line is short, because real paragraphs end
 * mid-measure — a stack of equal-length bars reads as a table, not prose.
 */
export function SkeletonText({
  lines = 3,
  className = "",
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div aria-hidden="true" className={`flex flex-col gap-2 ${className}`}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          className={`h-3.5 ${i === lines - 1 ? "w-2/5" : "w-full"}`}
        />
      ))}
    </div>
  );
}

/**
 * The indeterminate hairline at the top of every fallback. Deliberately not
 * position:fixed — see the `.nf-route-progress` note in app/globals.css for
 * why a fixed bar would anchor to the PageTransition wrapper instead of the
 * viewport.
 */
export function RouteProgress() {
  return <div aria-hidden="true" className="nf-route-progress" />;
}

/**
 * The wrapper every `loading.tsx` in this app returns.
 *
 * Carries the one accessible announcement for the whole fallback. `role`
 * defaults to "status" (an implicit aria-live="polite"), and the label is
 * visually hidden rather than printed — a sighted visitor already has the
 * progress hairline and the skeleton; only a screen reader needs the word.
 */
export function LoadingScreen({
  label = "Loading",
  className = "",
  children,
}: {
  label?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div role="status" aria-live="polite" className="nf-loading">
      <RouteProgress />
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className={className}>
        {children}
      </div>
    </div>
  );
}
