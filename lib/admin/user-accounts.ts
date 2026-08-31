import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { AppRoleValue } from "@/lib/validation/admin";

/**
 * Thin wrappers over the three admin-gated RPCs behind /admin/users. Each
 * one goes through the ordinary anon-key server client (lib/supabase/server.ts),
 * NOT lib/supabase/admin.ts's service-role client -- the admin check lives
 * inside each function in the database (Engineering Rule 3), so this layer
 * carries no authorization of its own and cannot accidentally become the
 * only gatekeeper.
 *
 * These were routed through callUntypedRpc while types/database.ts was stale;
 * the file has since been regenerated from the linked project, so all three
 * RPCs are fully typed and called directly. The hand-written row types below
 * are kept deliberately: they are what this module's callers depend on, and
 * they are wider (nullable) than the generated Returns rows, which describe
 * the SQL column list rather than each column's nullability.
 */

export type UserAccountRow = {
  user_id: string;
  email: string | null;
  display_name: string | null;
  avatar_emoji: string | null;
  role: AppRoleValue | null;
  created_at: string;
  last_sign_in_at: string | null;
  total_count: number;
};

export async function listUserAccounts(params: {
  search?: string;
  role?: AppRoleValue;
  limit: number;
  offset: number;
}): Promise<UserAccountRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_user_accounts", {
    p_search: params.search ?? undefined,
    p_role: params.role ?? undefined,
    p_limit: params.limit,
    p_offset: params.offset,
  });
  if (error) throw error;
  return (data ?? []) as UserAccountRow[];
}

/**
 * Total number of admin accounts, used only to decide whether the UI may
 * offer a demotion (see lib/admin/role-changes.ts). Read from the
 * window-function total_count the list RPC already returns, so it costs one
 * one-row query rather than a second counting function -- and it is a
 * genuine TOTAL, never the size of the current page.
 */
export async function countAdmins(): Promise<number> {
  const rows = await listUserAccounts({ role: "admin", limit: 1, offset: 0 });
  return rows[0]?.total_count ?? 0;
}

export type UserAccountDetail = {
  user_id: string;
  email: string | null;
  email_confirmed_at: string | null;
  display_name: string | null;
  avatar_emoji: string | null;
  home_country_code: string | null;
  public_profile_enabled: boolean | null;
  public_slug: string | null;
  role: AppRoleValue | null;
  role_updated_at: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  contributor_id: string | null;
  contributor_display_name: string | null;
  contributor_public_status: string | null;
  stories_owned: number;
  stories_published: number;
  stories_assigned_as_editor: number;
  recent_activity: unknown;
};

/**
 * Null for an unknown/soft-deleted id -- the RPC returns zero rows rather
 * than raising for that case, so the page can render the same flat 404 as
 * any other unknown route without distinguishing "no such account" from
 * "not allowed to see it".
 */
export async function getUserAccountDetail(
  userId: string,
): Promise<UserAccountDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_user_account_detail", {
    p_user_id: userId,
  });
  if (error) throw error;
  return ((data ?? []) as UserAccountDetail[])[0] ?? null;
}

/**
 * supabase/migrations/20260802085014_user_roles.sql#admin_set_user_role(),
 * extended with the last-admin guard in
 * 20260823090000_admin_set_user_role_last_admin_guard.sql. The only
 * sanctioned write path into user_roles, and until now it had no app-side
 * caller at all -- role changes were being made by hand in the SQL console.
 */
export async function setUserRole(params: {
  userId: string;
  role: AppRoleValue;
}): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_user_role", {
    p_target_user_id: params.userId,
    p_role: params.role,
  });
  if (error) throw error;
}
