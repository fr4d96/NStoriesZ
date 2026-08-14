"use client";

// Renders inside the root layout (where the skip link lives), so it needs
// its own #main-content target. Never renders error.message — that could
// leak internal details; only a generic message plus the error digest (safe,
// meant for support reference) is shown.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main
      id="main-content"
      className="mx-auto max-w-5xl px-4 py-16 text-center"
    >
      <h1 className="text-2xl font-semibold tracking-tight">
        Something went wrong
      </h1>
      <p className="mt-4 text-black/70 dark:text-white/70">
        Please try again. If this keeps happening, contact us and mention this
        reference: {error.digest ?? "n/a"}.
      </p>
      <button
        type="button"
        onClick={() => reset()}
        className="mt-6 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
      >
        Try again
      </button>
    </main>
  );
}
