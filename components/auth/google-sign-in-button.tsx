"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Google's official multi-color "G" mark -- kept self-contained here rather
 * than added to components/icons.tsx, since that set is deliberately
 * `currentColor`-only (see its own header comment) and a brand logomark
 * can't follow that convention (Google's brand guidelines require the real
 * colors on a "Sign in with Google" button, not a monochrome recolor).
 */
function GoogleGlyph() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M19.6 10.23c0-.68-.06-1.36-.18-2.02H10v3.83h5.38a4.6 4.6 0 0 1-2 3.02v2.5h3.23c1.9-1.75 2.99-4.32 2.99-7.33Z"
      />
      <path
        fill="#34A853"
        d="M10 20c2.7 0 4.96-.89 6.62-2.42l-3.23-2.5c-.9.6-2.05.96-3.39.96-2.6 0-4.8-1.76-5.59-4.12H1.07v2.59A10 10 0 0 0 10 20Z"
      />
      <path
        fill="#FBBC05"
        d="M4.41 11.92A5.99 5.99 0 0 1 4.09 10c0-.67.11-1.32.32-1.92V5.49H1.07A10 10 0 0 0 0 10c0 1.61.39 3.14 1.07 4.51l3.34-2.59Z"
      />
      <path
        fill="#EA4335"
        d="M10 3.96c1.47 0 2.79.5 3.82 1.5l2.87-2.87C14.95.99 12.7 0 10 0A10 10 0 0 0 1.07 5.49l3.34 2.59C5.2 5.72 7.4 3.96 10 3.96Z"
      />
    </svg>
  );
}

export function GoogleSignInButton({ next = "/account" }: { next?: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setError(null);
    setPending(true);

    const supabase = createClient();
    const redirectTo = new URL("/auth/callback", window.location.origin);
    redirectTo.searchParams.set("next", next);

    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: redirectTo.toString() },
    });

    // A successful call navigates the whole page to Google immediately --
    // this only ever runs for the failure case (e.g. the provider isn't
    // configured on this project, or a network error before the redirect).
    if (oauthError) {
      setError(oauthError.message);
      setPending(false);
    }
  }

  return (
    <div>
      <div className="my-5 flex items-center gap-3 text-xs font-medium text-black/40 dark:text-white/40">
        <span className="h-px flex-1 bg-black/10 dark:bg-white/10" />
        or
        <span className="h-px flex-1 bg-black/10 dark:bg-white/10" />
      </div>

      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="flex w-full items-center justify-center gap-2.5 rounded-md border border-black/20 px-3 py-2 text-sm font-medium transition-colors hover:bg-black/5 disabled:opacity-60 dark:border-white/20 dark:hover:bg-white/10"
      >
        <GoogleGlyph />
        {pending ? "Redirecting…" : "Continue with Google"}
      </button>

      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
