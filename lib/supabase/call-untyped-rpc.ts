import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Calls a Postgres RPC that exists in the live linked Supabase project but
 * is not yet reflected in the generated `types/database.ts` -- which happens
 * whenever a migration adds or re-signs a function and
 * `npm run supabase:types:linked` has not been re-run against the project
 * that migration was pushed to.
 *
 * NOTE (2026-09-09): this helper is back to ZERO call sites. The types were
 * regenerated from the linked project after the `usernames` migration was
 * pushed, which also caught up the two RPCs that had drifted onto it in the
 * meantime -- get_revision_selections (re-signed with an `expenses` output)
 * and set_revision_expenses -- so both are fully typed and called directly
 * again, as were list_user_accounts, get_user_account_detail,
 * admin_set_user_role, authorize_heic_transcode and
 * record_heic_transcoded_original before them. It is kept only because the
 * same gap reopens every time a new migration lands ahead of a
 * regeneration. The rule stays: the moment real types exist for an RPC, its
 * call site goes back to a plain, fully-typed `supabase.rpc(...)` call.
 *
 * This is a narrow escape hatch from the generated types, not from runtime
 * safety: the underlying PostgREST call, and every RPC's own server-side
 * authorization/validation, are completely unaffected by this cast.
 */
export async function callUntypedRpc<T>(
  supabase: SupabaseClient<Database>,
  fn: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) throw error;
  return data as unknown as T;
}
