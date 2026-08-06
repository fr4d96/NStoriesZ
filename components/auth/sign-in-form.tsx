"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signInAction, type AuthFormState } from "@/app/(auth)/actions";

const initialState: AuthFormState = {};

export function SignInForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(
    signInAction,
    initialState,
  );

  return (
    <form action={formAction} className="mt-8 space-y-5" noValidate>
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
          autoComplete="current-password"
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
        className="w-full rounded-md bg-black px-3 py-2 text-white hover:bg-black/80 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-white/80"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>

      <p className="text-sm text-black/70 dark:text-white/70">
        <Link href="/forgot-password" className="hover:underline">
          Forgot your password?
        </Link>
      </p>
      <p className="text-sm text-black/70 dark:text-white/70">
        No account?{" "}
        <Link href="/sign-up" className="hover:underline">
          Sign up
        </Link>
      </p>
    </form>
  );
}
