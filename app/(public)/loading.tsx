import {
  Skeleton,
  SkeletonText,
  LoadingScreen,
} from "@/components/ui/skeleton";

/**
 * Fallback for every public route that hasn't got a closer one — /about, the
 * four legal pages, and the home page.
 *
 * It sits inside (public)/layout.tsx, so SiteHeader and SiteFooter stay on
 * screen the whole time and only <main> is swapped. That, not the shimmer, is
 * what fixed the old "the whole window goes blank and says Loading…" feel.
 *
 * Shaped as a prose page (title, standfirst, body) because that is what all
 * of these routes are. The home page is the odd one out, but it builds
 * statically with a 1m revalidate, so it resolves inside the 140ms delay in
 * `.nf-loading` and this never paints for it.
 */
export default function PublicLoading() {
  return (
    <LoadingScreen
      label="Loading page"
      className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16"
    >
      <Skeleton className="h-9 w-3/4 max-w-md sm:h-11" />
      <SkeletonText className="mt-6 max-w-2xl" lines={2} />

      <div className="mt-12 flex flex-col gap-10">
        {[0, 1, 2].map((i) => (
          <div key={i} className="nf-skeleton-group flex flex-col gap-4">
            <Skeleton className="h-6 w-52" />
            <SkeletonText lines={4} />
          </div>
        ))}
      </div>
    </LoadingScreen>
  );
}
