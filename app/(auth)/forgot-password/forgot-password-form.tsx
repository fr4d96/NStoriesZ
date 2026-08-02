"use client";

import { useActionState } from "react";
import Link from "next/link";
import { forgotPasswordAction, type AuthFormState } from "@/app/(auth)/actions";

const initialState: AuthFormState = {};

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(
    forgotPasswordAction,
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
    <form action={formAction} className="mt-8 space-y-5" noValidate>
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

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-black px-3 py-2 text-white hover:bg-black/80 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-white/80"
      >
        {pending ? "Sending…" : "Send reset link"}
      </button>

      <p className="text-sm text-black/70 dark:text-white/70">
        <Link href="/sign-in" className="hover:underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
