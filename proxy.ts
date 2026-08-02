import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase auth cookie for the contributor area only — public
 * pages never touch Supabase, so they're excluded from the matcher below
 * rather than relying on a per-request cookie-presence check here. The
 * (contributor) layout still performs the real identity check via
 * getCurrentUser(); this proxy's only job is keeping the session cookie
 * fresh so that check has an up-to-date cookie to read.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Triggers a refresh (if needed) and writes the updated cookie via setAll.
  await supabase.auth.getClaims();

  return response;
}

export const config = {
  matcher: ["/my-stories/:path*", "/stories/new", "/account/:path*"],
};
