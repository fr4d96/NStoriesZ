import "server-only";
import { fetch as undiciFetch } from "undici";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { env, getAdminEnv } from "@/lib/env.server";
import type { Database } from "@/types/database";

/**
 * Service-role client — bypasses RLS entirely. This is the platform's one
 * and only privileged database boundary (Engineering Rule 1/2): it exists
 * solely for the image-processing/promotion pipeline
 * (lib/story/image-pipeline.ts), which is the ONLY module allowed to import
 * this file (enforced by the `no-restricted-imports` ESLint rule — see
 * eslint.config.mjs).
 *
 * Never used for ordinary story CRUD, never used to accept client-supplied
 * ids/paths without prior authorization via the regular (RLS-respecting)
 * client, and never imported from anything reachable by a Client Component.
 *
 * Uses `@supabase/supabase-js` directly (not `@supabase/ssr`) — no cookies,
 * no user session, a fresh client per call.
 *
 * `global.fetch` is pinned to undici's fetch, not `globalThis.fetch` (the
 * implicit default) -- inside a Next.js server, `globalThis.fetch` is
 * patched for the Data Cache, and that patched fetch does not reliably
 * preserve a binary request/response body. Verified live: image uploads
 * were still occasionally corrupted in production (stored bytes provably
 * wrong even fetched via plain `curl`, independent of any JS HTTP client)
 * after switching the upload body from a Buffer to a Blob alone -- only
 * fully stopped once every storage.download()/storage.upload() call in
 * this pipeline went through undici's fetch directly instead.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    getAdminEnv().SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: {
        fetch: undiciFetch as unknown as typeof fetch,
      },
    },
  );
}
