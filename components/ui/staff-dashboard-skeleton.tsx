import { Skeleton, LoadingScreen } from "@/components/ui/skeleton";

/**
 * Shared fallback body for the staff dashboards — /moderation, /admin,
 * /editorial and /readiness. They are the same page in four costumes: a
 * timestamp kicker, a title, a standfirst, a row of stat tiles, then a ruled
 * queue.
 *
 * One component rather than four near-identical files, so the staff areas
 * cannot drift apart the way four copies would. `width` is the only thing
 * that actually differs between them (editorial reads at max-w-5xl, the
 * others at max-w-7xl).
 *
 * These all sit under a layout that awaits getCurrentUserRole(), so — same as
 * the contributor area — the navigation blocks on the role check before this
 * paints. It covers the queue queries below it, which are the slow part.
 */
export function StaffDashboardSkeleton({
  label,
  width = "max-w-7xl",
  tiles = 4,
  rows = 6,
}: {
  label: string;
  width?: string;
  tiles?: number;
  rows?: number;
}) {
  return (
    <LoadingScreen
      label={label}
      className={`mx-auto ${width} px-4 py-10 sm:px-6 sm:py-14`}
    >
      <Skeleton className="h-3 w-40" />
      <Skeleton className="mt-3 h-8 w-56 sm:h-9" />
      <div className="mt-3 flex max-w-2xl flex-col gap-2">
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-3/5" />
      </div>

      <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: tiles }, (_, i) => (
          <div
            key={i}
            className="nf-skeleton-group flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface p-4 shadow-sm"
          >
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-3 w-28" />
          </div>
        ))}
      </div>

      <div className="mt-10 divide-y divide-border-subtle border-t border-border-subtle">
        {Array.from({ length: rows }, (_, i) => (
          <div
            key={i}
            className="nf-skeleton-group flex items-center gap-4 py-4"
          >
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-2/3 max-w-sm" />
              <Skeleton className="h-3 w-36" />
            </div>
            <Skeleton className="h-6 w-24 shrink-0 rounded-full" />
          </div>
        ))}
      </div>
    </LoadingScreen>
  );
}
