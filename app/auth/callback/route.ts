import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { resolveSafeReturnTo } from "@/lib/validation/safe-redirect";

/**
 * Handles both Supabase email-link shapes: PKCE `code` (used for OAuth and
 * some email flows) and `token_hash` + `type` (used for signup confirmation
 * and password recovery links). Never logs the incoming URL/tokens — only a
 * boolean success/failure. `next` is always re-validated through
 * resolveSafeReturnTo so this can never become an open redirect, regardless
 * of what a tampered link supplies.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = resolveSafeReturnTo(searchParams.get("next"), "/account");

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/sign-in?error=invalid_link`);
}
