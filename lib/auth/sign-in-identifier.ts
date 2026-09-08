import { emailSchema } from "@/lib/validation/auth";
import { USERNAME_PATTERN } from "@/lib/validation/username";

export type SignInIdentifier =
  { kind: "email"; email: string } | { kind: "username"; username: string };

/**
 * Decides whether what someone typed into the single "Email or username"
 * field is an email address or a username. Pure — no Supabase, no session,
 * no I/O — so it is unit-tested directly, in the same spirit as
 * lib/auth/post-login-redirect.ts.
 *
 * The two shapes cannot overlap: a username may not contain "@" (see
 * USERNAME_PATTERN and the matching `usernames_format` CHECK), and an email
 * must. So this is a decision, never a guess, and there is no input that
 * could be resolved two different ways depending on which branch ran first.
 *
 * Returns null for anything that is neither. The caller deliberately turns
 * that into the SAME generic "incorrect credentials" error as a wrong
 * password — never a distinct "that isn't a valid username" message, which
 * would hand an attacker a free username-format oracle and confirm that the
 * field even accepts usernames.
 */
export function classifySignInIdentifier(raw: string): SignInIdentifier | null {
  const value = raw.trim();
  if (!value) return null;

  if (value.includes("@")) {
    const parsed = emailSchema.safeParse(value);
    return parsed.success ? { kind: "email", email: parsed.data } : null;
  }

  const username = value.toLowerCase();
  return USERNAME_PATTERN.test(username)
    ? { kind: "username", username }
    : null;
}
