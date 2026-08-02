import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";

/**
 * Reads NEXT_PUBLIC_* vars directly (Next.js inlines these at build time)
 * rather than importing lib/env.server.ts, so this file never pulls the
 * server-only-guarded module into the browser bundle.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
