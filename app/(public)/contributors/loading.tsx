import { Skeleton, LoadingScreen } from "@/components/ui/skeleton";

/**
 * The contributor directory. Follows page.tsx's max-w-7xl container and its
 * 1/2/3-column card grid; twelve cards, half of the 24-per-page cursor batch,
 * so the fold is filled without implying a count the query might not return.
 */
export default function ContributorsLoading() {
  return (
    <LoadingScreen
      label="Loading contributors"
      className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16"
    >
      <Skeleton className="h-9 w-56 sm:h-11" />
      <div className="mt-4 flex max-w-2xl flex-col gap-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 12 }, (_, i) => (
          <div
            key={i}
            className="nf-skeleton-group flex flex-col gap-2 rounded-xl border border-border-subtle bg-surface p-4"
          >
            <Skeleton className="h-10 w-10 rounded-full" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-4/5" />
            <Skeleton className="mt-2 h-3 w-16" />
          </div>
        ))}
      </div>
    </LoadingScreen>
  );
}
