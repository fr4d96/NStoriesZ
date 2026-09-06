import {
  Skeleton,
  SkeletonText,
  LoadingScreen,
} from "@/components/ui/skeleton";

/**
 * Root fallback — the LAST resort, not the usual one.
 *
 * This file used to be the only loading state in the app, and it rendered the
 * bare word "Loading…". Sitting at the root segment means it replaces the
 * route group's layout too, so every single navigation blanked the header,
 * nav and footer and left one line of text in an empty window. That is what
 * made moving between pages feel broken.
 *
 * The fix is that it is now rarely reached: every route group has its own
 * `loading.tsx` nested under its layout, which keeps the chrome on screen.
 * This one only shows when the navigation crosses INTO a different group
 * (whose layout therefore has to be built from scratch) or lands on a route
 * with no group, like /index.
 *
 * Because there is genuinely no header on screen in those cases, it draws a
 * placeholder bar the height of one (min-h-[76px], matching SiteHeader and
 * ContributorNav) rather than collapsing the page to a centred word — the
 * structure holds still across the swap instead of jumping.
 */
export default function Loading() {
  return (
    <LoadingScreen label="Loading page">
      <div className="border-b border-border-subtle">
        <div className="mx-auto flex min-h-[76px] max-w-[1440px] items-center gap-5 px-4 sm:px-6">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <Skeleton className="h-5 w-28" />
          <div className="ml-auto hidden items-center gap-6 md:flex">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-9 w-32 rounded-full" />
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
        <Skeleton className="h-9 w-2/3 max-w-md sm:h-11" />
        <SkeletonText className="mt-6 max-w-2xl" lines={3} />
        <div className="mt-10 flex flex-col gap-3">
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
        </div>
      </div>
    </LoadingScreen>
  );
}
