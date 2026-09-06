import { Skeleton, LoadingScreen } from "@/components/ui/skeleton";

/**
 * Sign in / sign up / forgot / reset. All four are a narrow max-w-md column:
 * a heading and a stack of labelled fields with one primary button.
 *
 * Worth having even though these routes are fast — they are the routes a
 * visitor is bounced onto by the auth middleware, and arriving somewhere via
 * a redirect to a blank window is exactly the moment a missing loading state
 * reads as "the site broke", not "the site is thinking".
 */
export default function AuthLoading() {
  return (
    <LoadingScreen
      label="Loading"
      className="mx-auto max-w-md px-4 py-12 sm:px-6 sm:py-16"
    >
      <Skeleton className="h-8 w-40 sm:h-9" />
      <div className="mt-8 flex flex-col gap-5">
        {[0, 1].map((i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-11 w-full rounded-md" />
          </div>
        ))}
        <Skeleton className="h-11 w-full rounded-full" />
        <Skeleton className="h-4 w-48" />
      </div>
    </LoadingScreen>
  );
}
