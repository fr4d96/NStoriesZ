import "server-only";
import { createClient } from "@/lib/supabase/server";
import { callUntypedRpc } from "@/lib/supabase/call-untyped-rpc";
import type { AppRoleValue } from "@/lib/validation/admin";

/**
 * Thin wrappers over the three admin-gated RPCs behind /admin/users. Each
 * one goes through the ordinary anon-key server client (lib/supabase/server.ts),
 * NOT lib/supabase/admin.ts's service-role client -- the admin check lives
 * inside each function in the database (Engineering Rule 3), so this layer
 * carries no authorization of its own and cannot accidentally become the
 * only gatekeeper.
 *
 * callUntypedRpc is used because types/database.ts has not been regenerated
 * since these functions landed; see that helper's own comment for the
 * cleanup path.
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
  return callUntypedRpc<UserAccountRow[]>(supabase, "list_user_accounts", {
    p_search: params.search ?? null,
    p_role: params.role ?? null,
    p_limit: params.limit,
    p_offset: params.offset,
  });
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
  const rows = await callUntypedRpc<UserAccountDetail[]>(
    supabase,
    "get_user_account_detail",
    { p_user_id: userId },
  );
  return rows?.[0] ?? null;
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
  await callUntypedRpc<void>(supabase, "admin_set_user_role", {
    p_target_user_id: params.userId,
    p_role: params.role,
  });
}
