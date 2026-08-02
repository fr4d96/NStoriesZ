import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ResetPasswordForm } from "@/app/(auth)/reset-password/reset-password-form";

export const metadata: Metadata = {
  title: "Reset password",
};

/**
 * Requires the session /auth/callback established from the recovery link.
 * If it's missing (expired/already-used/tampered link), show a friendly
 * state instead of a broken form — never assume the link was valid.
 */
export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return (
      <div className="mx-auto max-w-sm px-4 py-12 sm:px-6 sm:py-16">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Link expired
        </h1>
        <p className="mt-4 text-sm text-black/70 dark:text-white/70">
          This password reset link is invalid or has already been used.
        </p>
        <p className="mt-4 text-sm">
          <Link href="/forgot-password" className="hover:underline">
            Request a new reset link
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-12 sm:px-6 sm:py-16">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        Choose a new password
      </h1>
      <ResetPasswordForm />
    </div>
  );
}
