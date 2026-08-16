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
      <p role="status" className="mt-8 text-sm text-muted-foreground">
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
          className="mt-1 w-full rounded-md border border-border-subtle px-3 py-2"
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-accent px-3 py-2 text-accent-foreground hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Sending…" : "Send reset link"}
      </button>

      <p className="text-sm text-muted-foreground">
        <Link href="/sign-in" className="hover:underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
