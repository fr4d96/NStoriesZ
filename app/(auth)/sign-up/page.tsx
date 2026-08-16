import type { Metadata } from "next";
import { SignUpForm } from "@/components/auth/sign-up-form";

export const metadata: Metadata = {
  title: "Sign up",
};

export default function SignUpPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:px-6 sm:py-16">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        Create your account
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Kakinotes publishes real, personal experiences — not advice. You&apos;ll
        choose how your name appears before anything you write is public.
      </p>
      <SignUpForm />
    </div>
  );
}
