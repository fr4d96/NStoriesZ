import { Skeleton } from "@/components/ui/skeleton";

/**
 * The loading stand-in for StoryCard. Mirrors that component's real
 * measurements — same rounded-xl bordered frame, same 4:3 cover, same p-4
 * body with a tag row, title, three-line excerpt and an attribution chip —
 * because a skeleton whose shape matches what lands is the whole trick: the
 * swap from placeholder to content moves nothing, so it reads as the page
 * sharpening rather than as a second layout.
 *
 * `nf-skeleton-group` staggers this card's sheen against its neighbours in a
 * grid; see the stagger note in app/globals.css.
 *
 * If StoryCard's frame changes, change this with it — the two drifting apart
 * reintroduces exactly the layout jump this exists to remove.
 */
export function StoryCardSkeleton() {
  return (
    <div className="nf-skeleton-group flex flex-col overflow-hidden rounded-xl border border-border-subtle bg-surface shadow-sm">
      <Skeleton className="aspect-[4/3] w-full rounded-none border-b border-border-subtle" />
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex flex-wrap gap-1.5">
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
        <Skeleton className="h-6 w-4/5" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-3/5" />
        </div>
        <div className="mt-auto flex items-center gap-2 pt-2">
          <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-3 w-32" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** A grid of them, at the same breakpoints the real story grids use. */
export function StoryCardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <StoryCardSkeleton key={i} />
      ))}
    </div>
  );
}
