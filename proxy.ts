import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PATHS = ["/my-stories", "/stories/new", "/account"];

function isProtectedPath(pathname: string) {
  return PROTECTED_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

/**
 * Refreshes the Supabase auth cookie for the contributor area only — public
 * pages never touch Supabase, so they're excluded from the matcher below
 * rather than relying on a per-request cookie-presence check here. Also
 * redirects signed-out requests to /sign-in?next=<original path>, since this
 * is the only place with access to the actual requested pathname; the
 * (contributor) layout still performs its own getCurrentUser() check as a
 * defense-in-depth backstop.
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
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims?.sub && isProtectedPath(request.nextUrl.pathname)) {
    const signInUrl = new URL("/sign-in", request.url);
    signInUrl.searchParams.set(
      "next",
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
    );
    return NextResponse.redirect(signInUrl);
  }

  return response;
}

export const config = {
  matcher: ["/my-stories/:path*", "/stories/new", "/account/:path*"],
};
