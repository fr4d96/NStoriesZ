import {
  Skeleton,
  SkeletonText,
  LoadingScreen,
} from "@/components/ui/skeleton";
import { StoryCardGridSkeleton } from "@/components/story/story-card-skeleton";

/**
 * The story reader. Slowest route in the app on a cold cache: it fetches the
 * story, its media, the active regions, and then up to two more queries for
 * related stories, so there is real time to fill here.
 *
 * Mirrors page.tsx's max-w-5xl column: the "personal experience" label, the
 * headline, the standfirst, the attribution chip, then alternating prose and
 * image blocks. The image placeholders use the same aspect ratios real story
 * images tend to land at, so the article does not reflow underneath the
 * reader as the pictures resolve.
 */
export default function StoryDetailLoading() {
  return (
    <LoadingScreen
      label="Loading story"
      className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16"
    >
      <Skeleton className="h-7 w-64 rounded-full" />

      <Skeleton className="mt-6 h-10 w-full max-w-3xl sm:h-12" />
      <Skeleton className="mt-3 h-10 w-3/5 max-w-xl sm:h-12" />

      <div className="mt-5 flex flex-col gap-2">
        <Skeleton className="h-5 w-full max-w-2xl" />
        <Skeleton className="h-5 w-2/3 max-w-lg" />
      </div>

      <div className="mt-6 flex items-center gap-2">
        <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-3 w-40" />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-5 w-24 rounded-full" />
      </div>

      <div className="mt-10 flex flex-col gap-8">
        <SkeletonText lines={5} />
        <Skeleton className="aspect-[16/9] w-full rounded-xl" />
        <SkeletonText lines={4} />
        <Skeleton className="aspect-[3/2] w-full rounded-xl" />
        <SkeletonText lines={3} />
      </div>

      <div className="mt-16">
        <Skeleton className="h-6 w-40" />
        <div className="mt-4">
          <StoryCardGridSkeleton count={3} />
        </div>
      </div>
    </LoadingScreen>
  );
}
