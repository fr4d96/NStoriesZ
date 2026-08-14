"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signUpAction, type AuthFormState } from "@/app/(auth)/actions";
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";

const initialState: AuthFormState = {};

export function SignUpForm() {
  const [state, formAction, pending] = useActionState(
    signUpAction,
    initialState,
  );

  if (state.success) {
    return (
      <p
        role="status"
        className="mt-8 text-sm text-black/70 dark:text-white/70"
      >
        {state.success}
      </p>
    );
  }

  return (
    <div className="mt-8">
      <form action={formAction} className="space-y-5" noValidate>
        <div>
          <label htmlFor="displayName" className="block text-sm font-medium">
            Display name (optional)
          </label>
          <input
            id="displayName"
            name="displayName"
            type="text"
            autoComplete="name"
            maxLength={120}
            className="mt-1 w-full rounded-md border border-black/20 px-3 py-2 dark:border-white/20"
          />
        </div>

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
            className="mt-1 w-full rounded-md border border-black/20 px-3 py-2 dark:border-white/20"
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
            autoComplete="new-password"
            minLength={6}
            required
            className="mt-1 w-full rounded-md border border-black/20 px-3 py-2 dark:border-white/20"
          />
        </div>

        {state.error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-accent px-3 py-2 text-accent-foreground hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Creating account…" : "Create account"}
        </button>

        <p className="text-sm text-black/70 dark:text-white/70">
          Already have an account?{" "}
          <Link href="/sign-in" className="hover:underline">
            Sign in
          </Link>
        </p>
      </form>

      <GoogleSignInButton next="/account" />
    </div>
  );
}
