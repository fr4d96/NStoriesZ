import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/app/(auth)/forgot-password/forgot-password-form";

export const metadata: Metadata = {
  title: "Forgot password",
};

export default function ForgotPasswordPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:px-6 sm:py-16">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        Reset your password
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Enter your email and we&apos;ll send a link to reset your password.
      </p>
      <ForgotPasswordForm />
    </div>
  );
}
