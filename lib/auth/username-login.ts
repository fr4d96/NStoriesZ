import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Resolves a username to the email address its account signs in with.
 *
 * Why this needs the service-role client at all: Supabase's
 * `signInWithPassword` accepts an email or a phone number and nothing else,
 * so username sign-in is unavoidably "look the email up first, then sign in
 * normally". At that moment the caller is ANONYMOUS — there is no session
 * yet — and emails live in `auth.users`, which the anon key cannot read.
 *
 * Why not a SECURITY DEFINER function granted to `anon` instead, which is
 * how every other privileged read in this codebase is done: such a function
 * would be callable directly over PostgREST by anyone holding the (public)
 * anon key, turning it into a bulk username-to-email harvester. There is no
 * way to expose it to the sign-in form without also exposing it to
 * everyone. So this is the one read that genuinely has to happen with the
 * service-role key, inside a Server Action, where the resolved email is
 * used immediately and never returned to the browser.
 *
 * This is therefore the SECOND module permitted to import
 * lib/supabase/admin.ts (see the no-restricted-imports allowlist in
 * eslint.config.mjs). It is deliberately tiny and does exactly one thing:
 * it takes no user id, no role, and no ownership claim from the caller, and
 * it returns an email to server-side code only.
 *
 * Returns null for every failure — unknown username, missing account, a
 * missing SUPABASE_SERVICE_ROLE_KEY (getAdminEnv() throws, which is why the
 * whole body is wrapped), or any transport error. signInAction turns null
 * into the same generic "incorrect credentials" message a wrong password
 * gets, so nothing here can confirm or deny that a username exists.
 */
export async function resolveEmailForUsername(
  username: string,
): Promise<string | null> {
  try {
    const admin = createAdminClient();

    const { data, error } = await admin
      .from("usernames")
      .select("user_id")
      .eq("username", username)
      .maybeSingle();

    if (error || !data) return null;

    // Goes through the Auth admin API rather than reading auth.users
    // directly: it is the supported surface, and it returns exactly one
    // account's record rather than opening a general query path into the
    // auth schema.
    const { data: account, error: accountError } =
      await admin.auth.admin.getUserById(data.user_id);

    if (accountError || !account.user?.email) return null;
    return account.user.email;
  } catch {
    return null;
  }
}
