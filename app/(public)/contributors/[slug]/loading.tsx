import { Skeleton, LoadingScreen } from "@/components/ui/skeleton";
import { StoryCardGridSkeleton } from "@/components/story/story-card-skeleton";

/**
 * One contributor's public profile: the 64px avatar + name block, an optional
 * bio, then their published stories in the same grid the rest of the site
 * uses. Matches page.tsx's max-w-7xl column.
 */
export default function ContributorProfileLoading() {
  return (
    <LoadingScreen
      label="Loading contributor profile"
      className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16"
    >
      <div className="flex items-center gap-4">
        <Skeleton className="h-16 w-16 shrink-0 rounded-full" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-48 sm:h-8" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>

      <div className="mt-6 flex max-w-2xl flex-col gap-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>

      <div className="mt-10">
        <Skeleton className="h-6 w-44" />
        <div className="mt-4">
          <StoryCardGridSkeleton count={3} />
        </div>
      </div>
    </LoadingScreen>
  );
}
