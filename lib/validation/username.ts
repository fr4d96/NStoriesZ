import { z } from "zod";

/**
 * Mirrors the CHECK constraints in
 * supabase/migrations/20260909090000_usernames.sql — duplicated
 * deliberately, on the same terms as lib/validation/profile.ts's slug rules
 * (Zod for a fast, friendly form error; the DB constraint as the
 * non-bypassable source of truth, Engineering Rule 3).
 *
 * Note the pattern excludes "@" — that is load-bearing, not incidental. It
 * is what lets lib/auth/sign-in-identifier.ts tell "this is an email" from
 * "this is a username" without ever having to guess.
 */
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9_-]{2,29}$/;

/**
 * Impersonation guard, kept in sync by hand with the `usernames_not_reserved`
 * CHECK. Covers role names, staff-workflow words, and the auth/route words
 * an account could otherwise use to look official.
 *
 * Every entry must itself satisfy USERNAME_PATTERN — a reserved word the
 * pattern already rejects (e.g. "me", too short) is dead weight in this
 * list and in the DB CHECK alike. username.test.ts asserts that.
 */
export const RESERVED_USERNAMES = [
  "admin",
  "admins",
  "administrator",
  "moderator",
  "moderators",
  "moderation",
  "editor",
  "editors",
  "editorial",
  "staff",
  "support",
  "help",
  "root",
  "system",
  "security",
  "official",
  "kakinotes",
  "api",
  "auth",
  "login",
  "logout",
  "signin",
  "sign-in",
  "signup",
  "sign-up",
  "account",
  "accounts",
  "settings",
  "null",
  "undefined",
  "anonymous",
  "stories",
  "contributors",
] as const;

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    USERNAME_PATTERN,
    "Use 3-30 lowercase letters, numbers, underscores, or hyphens, starting with a letter or number.",
  )
  .refine(
    (value) => !(RESERVED_USERNAMES as readonly string[]).includes(value),
    { message: "That username is reserved. Choose another." },
  );

export const setUsernameSchema = z.object({
  username: usernameSchema,
});

export type SetUsernameInput = z.infer<typeof setUsernameSchema>;
