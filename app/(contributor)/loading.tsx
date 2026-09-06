import { Skeleton, LoadingScreen } from "@/components/ui/skeleton";

/**
 * Fallback for the contributor area — /my-stories, /account, and the story
 * drafting routes. Sits under (contributor)/layout.tsx, so ContributorNav and
 * the footer stay put.
 *
 * One caveat that is worth knowing rather than working around: that layout
 * awaits getCurrentUser(), which is uncached runtime data, so per Next's
 * loading.js docs the navigation blocks on the layout before this fallback
 * can paint. It therefore covers the PAGE's data fetching (listMyStories and
 * friends), not the session check. Moving the session check would mean giving
 * up the layout-level guard, which is not a trade worth making for a
 * loading state.
 *
 * Shaped as the max-w-5xl heading + row list that /my-stories and the
 * editorial-style pages share.
 */
export default function ContributorLoading() {
  return (
    <LoadingScreen
      label="Loading your workspace"
      className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-11 w-40 rounded-full" />
      </div>

      <div className="mt-10 flex flex-col gap-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="nf-skeleton-group flex items-center gap-4 rounded-xl border border-border-subtle bg-surface p-4 shadow-sm"
          >
            <Skeleton className="h-16 w-24 shrink-0 rounded-lg" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-5 w-2/3 max-w-xs" />
              <Skeleton className="h-3.5 w-40" />
            </div>
            <Skeleton className="h-6 w-20 shrink-0 rounded-full" />
          </div>
        ))}
      </div>
    </LoadingScreen>
  );
}
