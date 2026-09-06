import { Skeleton, LoadingScreen } from "@/components/ui/skeleton";
import { StoryCardGridSkeleton } from "@/components/story/story-card-skeleton";

/**
 * /stories is the slowest public route and the one this matters most for:
 * it awaits searchParams, which forces dynamic rendering (see the comment in
 * its page.tsx), so it can never be served from a prefetched static shell.
 * Every filter change is a real round trip.
 *
 * The shape follows page.tsx exactly — same max-w-[1440px] container, the
 * seven-control filter grid at its own breakpoints, then the 1/2/3-column
 * card grid — so when the stories land nothing shifts. Six cards, because
 * that fills one viewport at the lg breakpoint without pretending to know how
 * many results the filters will actually return.
 */
export default function StoriesLoading() {
  return (
    <LoadingScreen
      label="Loading stories"
      className="mx-auto max-w-[1440px] px-4 py-12 sm:px-6 sm:py-16"
    >
      <div className="max-w-2xl">
        <Skeleton className="h-9 w-40 sm:h-11" />
        <div className="mt-4 flex flex-col gap-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      </div>

      <div className="mt-8 rounded-xl border border-border-subtle bg-surface p-4 shadow-sm">
        <div className="mb-4 flex flex-col gap-1.5">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-10 w-full rounded-md" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-10 w-full rounded-md" />
            </div>
          ))}
        </div>
      </div>

      <div className="mt-8">
        <StoryCardGridSkeleton count={6} />
      </div>
    </LoadingScreen>
  );
}
