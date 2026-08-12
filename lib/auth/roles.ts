import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import type { AppRole } from "@/lib/auth/staff-guard";

export type { AppRole, StaffAccessDecision } from "@/lib/auth/staff-guard";
export { resolveStaffAccess } from "@/lib/auth/staff-guard";

/**
 * Reads the caller's OWN role only — relies on the `user_roles: read own
 * role` RLS policy, never a client-supplied role claim. Wrapped in cache()
 * so repeated calls in one request only hit Supabase once. Returns null if
 * signed out or the row is somehow missing (fails closed to "no role").
 */
export const getCurrentUserRole = cache(async (): Promise<AppRole | null> => {
  const user = await getCurrentUser();
  if (!user) {
    return null;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .single();

  if (error || !data) {
    return null;
  }

  return data.role;
});

/**
 * The caller's own chosen avatar emoji (profiles.avatar_emoji), or null if
 * signed out / unset — feeds UserAvatarMenu everywhere it's rendered
 * server-side (ContributorNav, ModerationNav, EditorialNav, ReadinessNav).
 * RLS already scopes this to auth.uid() (see profiles' own "owner reads own
 * profile" policy), never a client-supplied id. Wrapped in cache() for the
 * same reason as getCurrentUserRole.
 */
export const getCurrentUserAvatarEmoji = cache(
  async (): Promise<string | null> => {
    const user = await getCurrentUser();
    if (!user) {
      return null;
    }

    const supabase = await createClient();
    const { data } = await supabase
      .from("profiles")
      .select("avatar_emoji")
      .eq("id", user.id)
      .single();

    return data?.avatar_emoji ?? null;
  },
);
