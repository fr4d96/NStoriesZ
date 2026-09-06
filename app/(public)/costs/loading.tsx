import {
  Skeleton,
  SkeletonText,
  LoadingScreen,
} from "@/components/ui/skeleton";

/**
 * The cost aggregates page. Every figure on it comes from one getAggregates()
 * call that runs four separate percentile queries, so this route has real work
 * to do before it can render anything.
 *
 * Four sections in page.tsx's max-w-3xl reading column: two headline "band"
 * figures (a big number plus its range sentence) and two ruled lists. The
 * lists use the same divide-y hairlines as the real NamedBandList so the rows
 * do not shift when the numbers arrive.
 */
function BandFigureSkeleton() {
  return (
    <div className="nf-skeleton-group mt-3 flex flex-col gap-3">
      <Skeleton className="h-9 w-56" />
      <Skeleton className="h-4 w-full max-w-lg" />
      <Skeleton className="h-4 w-2/3 max-w-md" />
    </div>
  );
}

function NamedBandListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="nf-skeleton-group mt-3 divide-y divide-border-subtle border-t border-border-subtle">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center justify-between gap-4 py-3">
          <Skeleton className="h-4 w-40 max-w-[45%] flex-1" />
          <Skeleton className="h-4 w-16 shrink-0" />
          <Skeleton className="h-4 w-20 shrink-0" />
        </div>
      ))}
    </div>
  );
}

export default function CostsLoading() {
  return (
    <LoadingScreen
      label="Loading cost figures"
      className="mx-auto max-w-3xl px-4 py-10 sm:px-6"
    >
      <Skeleton className="h-9 w-full max-w-lg" />
      <SkeletonText className="mt-5" lines={4} />

      <section className="mt-10">
        <Skeleton className="h-6 w-64" />
        <BandFigureSkeleton />
      </section>

      <section className="mt-10">
        <Skeleton className="h-6 w-56" />
        <BandFigureSkeleton />
      </section>

      <section className="mt-10">
        <Skeleton className="h-6 w-28" />
        <NamedBandListSkeleton rows={6} />
      </section>

      <section className="mt-10">
        <Skeleton className="h-6 w-52" />
        <NamedBandListSkeleton rows={5} />
      </section>
    </LoadingScreen>
  );
}
