import Link from "next/link";

// Renders inside the root layout (where the skip link lives), so it needs
// its own #main-content target.
export default function NotFound() {
  return (
    <main
      id="main-content"
      className="mx-auto max-w-5xl px-4 py-16 text-center"
    >
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-4 text-black/70 dark:text-white/70">
        We couldn&apos;t find the page you were looking for.
      </p>
      <Link href="/" className="mt-6 inline-block underline">
        Go home
      </Link>
    </main>
  );
}
