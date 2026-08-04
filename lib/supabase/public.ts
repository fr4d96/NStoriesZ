import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env.server";
import type { Database } from "@/types/database";

/**
 * A cookie-free Supabase client for genuinely anonymous public reads
 * (list_published_stories, get_published_story, list_public_contributors,
 * etc. -- the only three-plus RPCs granted to `anon`, per
 * docs/architecture.md "Public reads"). lib/supabase/server.ts calls
 * next/headers' cookies(), which unconditionally opts a route out of static
 * rendering/ISR in the App Router regardless of `export const revalidate`
 * -- verified by reading its implementation before assuming `revalidate`
 * would do anything on a page that only ever calls anon-granted RPCs.
 * Using this client instead of the cookie-bound one is what actually lets
 * `export const revalidate = 60` on the public story/contributor pages take
 * effect. Never used for anything that needs the caller's session (auth
 * state, ownership, RLS-scoped reads) -- those still go through
 * lib/supabase/server.ts.
 */
export function createPublicClient() {
  return createSupabaseClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false } },
  );
}
