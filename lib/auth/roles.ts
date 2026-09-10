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
 * The caller's own chosen avatar emoji, or null if signed out / unset —
 * feeds UserAvatarMenu everywhere it's rendered server-side (ContributorNav,
 * ModerationNav, EditorialNav, ReadinessNav).
 *
 * Reads `contributors.avatar_emoji` first and falls back to
 * `profiles.avatar_emoji`. 20260910090000 moved the single avatar picker
 * onto the contributor identity (it is a PUBLIC field -- it shows on the
 * byline page), which left profiles.avatar_emoji written by nothing. The
 * fallback is not decoration: every account that picked an avatar before
 * that migration still has its value there, and a signed-in user with no
 * contributor record yet has nowhere else for one to live. Both reads are
 * RLS-scoped to auth.uid() by the tables' own owner-read policies, never a
 * client-supplied id. Wrapped in cache() for the same reason as
 * getCurrentUserRole.
 */
export const getCurrentUserAvatarEmoji = cache(
  async (): Promise<string | null> => {
    const user = await getCurrentUser();
    if (!user) {
      return null;
    }

    const supabase = await createClient();
    const [{ data: contributor }, { data: profile }] = await Promise.all([
      supabase
        .from("contributors")
        .select("avatar_emoji")
        .eq("linked_user_id", user.id)
        .maybeSingle(),
      supabase
        .from("profiles")
        .select("avatar_emoji")
        .eq("id", user.id)
        .maybeSingle(),
    ]);

    return contributor?.avatar_emoji ?? profile?.avatar_emoji ?? null;
  },
);
