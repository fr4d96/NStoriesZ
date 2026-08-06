import type { Metadata } from "next";
import { resolveSafeReturnTo } from "@/lib/validation/safe-redirect";
import { SignInForm } from "@/components/auth/sign-in-form";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const next = resolveSafeReturnTo(params.next, "/account");

  return (
    <div className="mx-auto max-w-sm px-4 py-12 sm:px-6 sm:py-16">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        Sign in
      </h1>
      {params.error === "invalid_link" && (
        <p
          role="alert"
          className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          That link is invalid or has expired. Please try again.
        </p>
      )}
      <SignInForm next={next} />
    </div>
  );
}
