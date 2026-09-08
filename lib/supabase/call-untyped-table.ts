import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * The table-level twin of lib/supabase/call-untyped-rpc.ts, for a table
 * that exists in the live linked Supabase project but is not yet reflected
 * in the generated `types/database.ts` -- which is the state every new
 * table is in between "the migration is written" and "the migration is
 * pushed and `npm run supabase:types:linked` has been re-run".
 *
 * NOTE (2026-09-09): ZERO call sites. Its one user, `expense_categories`
 * in lib/story/active-lookups.ts, went back to a plain, fully-typed
 * `supabase.from("expense_categories")` once types/database.ts was
 * regenerated. Kept on the same terms as its RPC twin
 * (lib/supabase/call-untyped-rpc.ts): the gap reopens every time a
 * migration lands ahead of a regeneration, and the rule stays that a call
 * site returns to plain typed access the moment real types exist.
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
