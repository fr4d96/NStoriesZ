import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * The table-level twin of lib/supabase/call-untyped-rpc.ts, for a table
 * that exists in the live linked Supabase project but is not yet reflected
 * in the generated `types/database.ts` -- which is the state every new
 * table is in between "the migration is written" and "the migration is
 * pushed and `npm run supabase:types:linked` has been re-run".
 *
 * In use as of 2026-09-02 for `expense_categories`
 * (supabase/migrations/20260902110000_expense_categories.sql). The rule is
 * the same as the RPC helper's: the moment real types exist for a table,
 * its call site goes back to a plain, fully-typed `supabase.from(...)`
 * call and this stops being imported.
 *
 * This is an escape hatch from the GENERATED TYPES only, never from
 * runtime safety. The PostgREST request, this table's RLS policies, and
 * its column grants are all completely unaffected by the cast -- an
 * `expense_categories` read still returns only what the caller's role is
 * allowed to see.
 */
export function untypedFrom(
  supabase: SupabaseClient<Database>,
  table: string,
): {
  select: (columns: string) => {
    eq: (
      column: string,
      value: unknown,
    ) => {
      order: (
        column: string,
        options?: { ascending?: boolean },
      ) => PromiseLike<{
        data: Array<Record<string, unknown>> | null;
        error: { message: string } | null;
      }> & {
        order: (
          column: string,
          options?: { ascending?: boolean },
        ) => PromiseLike<{
          data: Array<Record<string, unknown>> | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
} {
  return supabase.from(table as never) as unknown as ReturnType<
    typeof untypedFrom
  >;
}
