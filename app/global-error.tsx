"use client";

// Replaces the ENTIRE root layout when the root layout itself throws, so it
// must render its own <html>/<body> — the root layout's skip link and shell
// are not present here. Never renders error.message.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <main
          id="main-content"
          style={{
            maxWidth: 640,
            margin: "4rem auto",
            padding: "0 1rem",
            textAlign: "center",
          }}
        >
          <h1>Something went wrong</h1>
          <p>
            Please try again. If this keeps happening, contact us and mention
            this reference: {error.digest ?? "n/a"}.
          </p>
          <button type="button" onClick={() => reset()}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
