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
