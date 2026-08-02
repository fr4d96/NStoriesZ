import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "@/lib/env.server";
import type { Database } from "@/types/database";

/**
 * Create a new client per request — never share one across requests/renders.
 * `setAll` is wrapped in try/catch because Server Components cannot set
 * cookies; when that throws, the proxy (proxy.ts) is relied on to refresh
 * and persist the session cookie instead. Server Actions and Route Handlers
 * *can* set cookies, so setAll still works there.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — safe to ignore because the
            // proxy refreshes the session cookie for the routes that need it.
          }
        },
      },
    },
  );
}
