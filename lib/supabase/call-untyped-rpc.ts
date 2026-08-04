import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Calls a Postgres RPC that exists in the live linked Supabase project but
 * is not yet reflected in the generated `types/database.ts` -- true for
 * every function Prompt 4 Sub-phase 4's migrations add or change a
 * signature of, until `npm run supabase:types:linked` is re-run AFTER those
 * migrations are pushed (a stop-gate this session does not cross without
 * explicit go-ahead; see docs/implementation-status.md "Prompt 4 Sub-phase 4
 * detail"). Once real types land, every call site using this helper should
 * be converted back to a plain, fully-typed `supabase.rpc(...)` call and
 * this import removed -- the same "as never" workaround / cleanup this
 * codebase already did once before, for `get_revision_selections()` in
 * Sub-phase 3.
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
