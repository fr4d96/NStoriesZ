"use client";

import { useActionState } from "react";
import { resetPasswordAction, type AuthFormState } from "@/app/(auth)/actions";

const initialState: AuthFormState = {};

export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState(
    resetPasswordAction,
    initialState,
  );

  return (
    <form action={formAction} className="mt-8 space-y-5" noValidate>
      <div>
        <label htmlFor="password" className="block text-sm font-medium">
          New password
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

      <div>
        <label htmlFor="confirmPassword" className="block text-sm font-medium">
          Confirm new password
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
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
        className="w-full rounded-md bg-black px-3 py-2 text-white hover:bg-black/80 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-white/80"
      >
        {pending ? "Saving…" : "Save new password"}
      </button>
    </form>
  );
}
