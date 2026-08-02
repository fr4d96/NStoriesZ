"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  signUpSchema,
  signInSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from "@/lib/validation/auth";
import { resolveSafeReturnTo } from "@/lib/validation/safe-redirect";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export type AuthFormState = {
  error?: string;
  success?: string;
};

export async function signUpAction(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = signUpSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    displayName: formData.get("displayName") ?? "",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: parsed.data.displayName
        ? { display_name: parsed.data.displayName }
        : undefined,
      emailRedirectTo: `${siteUrl}/auth/callback?next=/account`,
    },
  });

  if (error) {
    // Supabase's own message here is already generic enough not to
    // confirm/deny account existence when email confirmations are on; we
    // pass it through rather than inventing our own wording.
    return { error: error.message };
  }

  return {
    success:
      "Check your email to confirm your account before signing in. If email confirmation is disabled for this project, you can sign in right away.",
  };
}

export async function signInAction(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    // Deliberately generic — never confirms whether the email is registered.
    return { error: "Incorrect email or password." };
  }

  const next = resolveSafeReturnTo(
    formData.get("next")?.toString(),
    "/account",
  );
  redirect(next);
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}

export async function forgotPasswordAction(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = forgotPasswordSchema.safeParse({
    email: formData.get("email"),
  });

  // Generic response regardless of validation outcome or whether the email
  // exists — never confirms/denies account existence (Prompt 2 brief:
  // "Use generic forgot-password responses").
  const genericSuccess: AuthFormState = {
    success:
      "If an account exists for that email, we've sent a link to reset your password.",
  };

  if (!parsed.success) {
    return genericSuccess;
  }

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${siteUrl}/auth/callback?next=/reset-password`,
  });

  return genericSuccess;
}

export async function resetPasswordAction(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = resetPasswordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createClient();

  // Requires an active session established by /auth/callback via the
  // recovery link — never trusts a client-supplied user id.
  const { data: userData, error: getUserError } = await supabase.auth.getUser();
  if (getUserError || !userData.user) {
    return {
      error:
        "Your password reset link has expired or already been used. Request a new one.",
    };
  }

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });

  if (error) {
    return { error: error.message };
  }

  redirect("/account");
}
