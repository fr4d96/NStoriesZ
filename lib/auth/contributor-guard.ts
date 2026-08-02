import type { CurrentUser } from "@/lib/auth/get-current-user";

export type ContributorAccessDecision =
  { ok: true; user: CurrentUser } | { ok: false; redirectTo: string };

/**
 * Pure decision function, kept separate from the (contributor) layout so it
 * can be unit-tested directly on plain input/output instead of rendering an
 * async Server Component.
 */
export function resolveContributorAccess(
  user: CurrentUser | null,
): ContributorAccessDecision {
  if (!user) {
    return { ok: false, redirectTo: "/sign-in" };
  }

  return { ok: true, user };
}
