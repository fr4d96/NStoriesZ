"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signInAction, type AuthFormState } from "@/app/(auth)/actions";
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";

const initialState: AuthFormState = {};

export function SignInForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(
    signInAction,
    initialState,
  );

  return (
    <div className="mt-8">
      <form action={formAction} className="space-y-5" noValidate>
        <input type="hidden" name="next" value={next} />

        <div>
          <label htmlFor="email" className="block text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className="mt-1 w-full rounded-md border border-border-subtle px-3 py-2"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="mt-1 w-full rounded-md border border-border-subtle px-3 py-2"
          />
        </div>

        {state.error && (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-accent px-3 py-2 text-accent-foreground hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>

        <p className="text-sm text-muted-foreground">
          <Link href="/forgot-password" className="hover:underline">
            Forgot your password?
          </Link>
        </p>
        <p className="text-sm text-muted-foreground">
          No account?{" "}
          <Link href="/sign-up" className="hover:underline">
            Sign up
          </Link>
        </p>
      </form>

      <GoogleSignInButton next={next} />
    </div>
  );
}
