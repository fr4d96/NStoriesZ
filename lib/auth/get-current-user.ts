import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type CurrentUser = { id: string };

/**
 * Wrapped in React's cache() so multiple calls within one request only hit
 * Supabase once. Returns the minimum identity field needed today — no email,
 * since nothing yet requires it. Called only from the (contributor) layout;
 * public pages/layouts never call this.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims?.sub) {
    return null;
  }

  return { id: data.claims.sub };
});
