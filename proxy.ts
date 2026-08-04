import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PATHS = ["/my-stories", "/stories/new", "/account"];
// Dynamic authoring routes added in Prompt 4 Sub-phase 3 — /stories/:id/edit
// (plus its nested upload Route Handler) and /stories/:id/preview both
// require a signed-in session; a static string list can't express the :id
// segment, so these get their own pattern.
const PROTECTED_DYNAMIC_STORY_PATH =
  /^\/stories\/[^/]+\/(edit|preview)(\/.*)?$/;
const PREVIEW_PATH = /^\/stories\/[^/]+\/preview(\/.*)?$/;

// /editorial/* (Prompt 4 Sub-phase 4). Real pages now, not a Route Handler
// stub — but a page-based notFound() (app/(editor)/editorial/layout.tsx)
// was confirmed live, via a real `curl -i`, to still return HTTP 200 for a
// signed-out visitor (the App Router streams the shell before the deep
// notFound() boundary attaches — exactly the failure mode
// docs/architecture.md documents as the reason Prompt 1 originally chose
// Route Handlers over pages for /moderation and /admin). The layout's
// notFound() call is kept as a defense-in-depth backstop, but THIS check,
// here in middleware (which runs before any RSC streaming and can set a
// real response status directly), is the one that actually produces a
// true 404 — verified the same way, by `curl -i`, after this fix.
const STAFF_EDITORIAL_PATH = /^\/editorial(\/.*)?$/;

function isProtectedPath(pathname: string) {
  return (
    PROTECTED_PATHS.some(
      (path) => pathname === path || pathname.startsWith(`${path}/`),
    ) || PROTECTED_DYNAMIC_STORY_PATH.test(pathname)
  );
}

function flatNotFound() {
  // Identical shape to the existing /moderation and /admin Route Handler
  // stubs' 404 body — anyone without the required role gets the same flat
  // response as a signed-out visitor, no matter which staff area they hit
  // or how the check happens to be implemented underneath.
  return NextResponse.json({ error: "Not Found" }, { status: 404 });
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

  if (STAFF_EDITORIAL_PATH.test(request.nextUrl.pathname)) {
    // Signed-out and signed-in-with-the-wrong-role get the IDENTICAL flat
    // 404 — no information leak about which case it was, same convention
    // as every other staff route in this app.
    if (!data?.claims?.sub) {
      return flatNotFound();
    }
    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", data.claims.sub)
      .single();
    if (roleRow?.role !== "editor" && roleRow?.role !== "admin") {
      return flatNotFound();
    }
  }

  // The preview page can render draft/unpublished content — never cached at
  // any layer, on top of the page itself already opting out via
  // `export const dynamic = "force-dynamic"`.
  if (PREVIEW_PATH.test(request.nextUrl.pathname)) {
    response.headers.set("Cache-Control", "no-store");
  }

  return response;
}

export const config = {
  matcher: [
    "/my-stories/:path*",
    "/stories/new",
    "/account/:path*",
    "/stories/:id/edit/:path*",
    "/stories/:id/preview/:path*",
    "/editorial",
    "/editorial/:path*",
  ],
};
