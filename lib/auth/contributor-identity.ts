import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import type { AppRole } from "@/lib/auth/staff-guard";
import {
  defaultPathForRole,
  landingPathAfterSignIn,
} from "@/lib/auth/post-login-redirect";

/**
 * Does the caller already have a contributor identity of their own?
 *
 * Reads the caller's OWN row only: the filter is `linked_user_id = <the
 * session's user id>`, never a client-supplied id, and contributors' RLS
 * scopes the read to the same user regardless (Engineering Rule 2/3).
 * Wrapped in cache() so a request that asks twice only queries once.
 *
 * Fails closed to `true` on an unexpected query error: this only decides
 * where a sign-in lands, and sending an existing contributor to a setup
 * page they don't need would be a worse failure than skipping the nudge.
 */
export const hasContributorIdentity = cache(async (): Promise<boolean> => {
  const user = await getCurrentUser();
  if (!user) return false;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contributors")
    .select("id")
    .eq("linked_user_id", user.id)
    .maybeSingle();

  if (error) return true;
  return data != null;
});

/**
 * Server-side wrapper around landingPathAfterSignIn(): only queries for the
 * contributor identity when the role-based answer is the ordinary
 * contributor default, so a staff sign-in costs no extra round trip.
 */
export async function resolveSignInLandingPath(
  role: AppRole | null,
): Promise<string> {
  if (defaultPathForRole(role) !== "/my-stories") {
    return defaultPathForRole(role);
  }
  return landingPathAfterSignIn(role, await hasContributorIdentity());
}
