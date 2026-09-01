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
 *
 * `fetch` is an opt-in override, left unset (Supabase's own default) for
 * every caller. It exists because the old
 * app/(contributor)/stories/[id]/edit/upload/route.ts relayed original-file
 * bytes through this server and had to pin undici's fetch instead of
 * `globalThis.fetch`, which Next.js patches for the Data Cache in a way that
 * does not reliably preserve a binary request/response body (see the matching
 * comment on lib/supabase/admin.ts's createAdminClient for the full story).
 *
 * That route no longer exists: the direct-to-storage change
 * (20260827090000_direct_to_storage_uploads.sql,
 * app/(contributor)/stories/[id]/edit/upload-actions.ts) moved those bytes off
 * this server entirely, and the image pipeline went further still, dropping to
 * raw node:https via lib/story/raw-storage-http.ts. So this parameter
 * currently has NO callers -- grepped and confirmed. Kept as an extension
 * point rather than removed, since any future binary-body caller through the
 * session-bound client would need exactly this; delete it if that never
 * arrives.
 */
export async function createClient(overrides?: { fetch?: typeof fetch }) {
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
      ...(overrides?.fetch ? { global: { fetch: overrides.fetch } } : {}),
    },
  );
}
