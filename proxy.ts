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

// Exact-match-only patterns (no trailing (\/.*)? subpath) for the three
// PAGE routes Prompt 4 Sub-phase 5 found leaking a per-row-unauthorized
// visitor through as a live HTTP 200 — see canReadStoryDraft/
// canPreviewStory and their call sites below for the fix. Deliberately narrower than
// PROTECTED_DYNAMIC_STORY_PATH above: /stories/:id/edit/upload (the nested
// Route Handler) must NOT match here, since a Route Handler already sets
// its own real status codes correctly (confirmed live: it already returns
// a genuine 400 for an unauthorized caller) and matching it here would mean
// consuming/racing its request body for no reason.
const STORY_EDIT_PAGE_PATH = /^\/stories\/([^/]+)\/edit$/;
const STORY_PREVIEW_PAGE_PATH = /^\/stories\/([^/]+)\/preview$/;
const EDITORIAL_EDIT_PAGE_PATH = /^\/editorial\/([^/]+)\/edit$/;
// Prompt 6 Stage 2: exact-match-only, same reasoning as the two patterns
// above -- /moderation/stories/:id/anything-nested (there is none today,
// but this stays narrow on purpose) must not be swept in here.
const MODERATION_REVIEW_PAGE_PATH = /^\/moderation\/stories\/([^/]+)$/;
// Release audit: mirrors MODERATION_REVIEW_PAGE_PATH exactly, for
// /moderation/reports/[id] -- previously flagged in
// docs/implementation-status.md as a known, accepted gap (the reports
// detail page had no middleware-level per-row existence check, unlike the
// story review page). Exact-match-only for the same reason as the other
// per-row patterns above.
const MODERATION_REPORT_PAGE_PATH = /^\/moderation\/reports\/([^/]+)$/;

// Prompt 5: the exact same "a page-based notFound() deep in an RSC tree
// doesn't set a real HTTP status" failure mode documented above for the
// staff/per-row cases, live-confirmed again for the PUBLIC story/
// contributor detail pages: a non-existent slug returned a live HTTP 200
// (via app/(public)/stories/[id]/page.tsx's plain `notFound()` call) in a
// real Playwright run. Not a security leak like the private per-row
// cases -- a public row is public either way -- but a real correctness bug
// against the brief's own "denial of ... non-existent ... content" test
// requirement and basic SEO hygiene (a 200 for a dead link is a soft-404).
// Fixed the same proven way: an existence check here, before any RSC
// render can commit a 200. "new" is excluded from the story pattern since
// /stories/new is a real static route (start a draft), not a slug.
const STORY_DETAIL_PAGE_PATH = /^\/stories\/([^/]+)$/;
const CONTRIBUTOR_DETAIL_PAGE_PATH = /^\/contributors\/([^/]+)$/;

function publicNotFound() {
  return new NextResponse(
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Not found | Kakinotes</title></head>' +
      "<body><h1>Page not found</h1><p>This page does not exist or is no longer available.</p>" +
      '<p><a href="/stories">Browse stories</a></p></body></html>',
    { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

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

// Prompt 6 Stage 2: /moderation gains real pages (app/(moderation)/moderation/route.ts,
// the old role-gated JSON stub, is deleted by this change). Mirrors
// STAFF_EDITORIAL_PATH exactly -- same flat 404 for signed-out and
// wrong-role, same reasoning about why this check has to live here (not
// just in app/(moderation)/moderation/layout.tsx) rather than being
// assumed equivalent.
const STAFF_MODERATION_PATH = /^\/moderation(\/.*)?$/;

// Prompt 7: /readiness, the content-readiness dashboard + operational
// metrics. Reachable by editor, moderator, OR admin (readiness spans both
// editorial prep and moderation state -- it doesn't belong to only one
// staff role's existing workspace). Same flat-404 convention and same
// "middleware, not a page-level notFound(), is what actually produces a
// true HTTP 404" reasoning as STAFF_EDITORIAL_PATH/STAFF_MODERATION_PATH
// above.
const STAFF_READINESS_PATH = /^\/readiness(\/.*)?$/;

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

// Prompt 4 Sub-phase 5 finding: get_my_story_with_draft() and
// get_story_preview() (supabase/migrations/20260804092500_..., 20260804092200_...)
// both RAISE a Postgres exception -- they never just return zero rows --
// for a per-row-unauthorized caller. app/(contributor)/stories/[id]/edit/page.tsx
// and app/(editor)/editorial/[id]/edit/page.tsx don't even catch that
// exception (it reaches Next's generic error boundary); app/(contributor)/stories/[id]/preview/page.tsx
// DOES catch it and calls notFound() -- but live-verified via real
// Playwright navigations in e2e/cross-contributor-access.spec.ts, ALL
// THREE still returned a live HTTP 200 (either the generic error page or
// the not-found UI, but never a real 404 status). This is the exact same
// failure mode already documented above for /editorial's role check: a
// deep, no-earlier-Suspense-boundary Server Component tree's notFound()/
// thrown error doesn't set the response's real status in this app's
// current Next.js/Turbopack setup. The fix is identical in shape: decide
// authorization here, before any RSC render can commit a 200, and return a
// real 404 directly. This necessarily means an extra DB round trip
// middleware couldn't avoid taking (see PROTECTED_DYNAMIC_STORY_PATH's
// comment above) -- correctness over the redundant-query cost, and the
// page component itself is left as-is (it re-derives the same
// authorization on its own request for defense-in-depth, per Engineering
// Rules 2/3; RLS/the RPC itself remains the authoritative check, this is
// just the layer that can actually surface a true HTTP status for it).
async function canReadStoryDraft(
  supabase: ReturnType<typeof createServerClient>,
  storyId: string,
) {
  const { data, error } = await supabase.rpc("get_my_story_with_draft", {
    p_story_id: storyId,
  });
  return !error && Array.isArray(data) && data.length > 0;
}

async function canPreviewStory(
  supabase: ReturnType<typeof createServerClient>,
  storyId: string,
) {
  const { data, error } = await supabase.rpc("get_story_preview", {
    p_story_id: storyId,
  });
  return !error && Array.isArray(data) && data.length > 0;
}

/**
 * Prompt 6 Stage 2: cheap, existence-only per-row check for a moderation
 * review page, via can_view_moderation_review()
 * (supabase/migrations/20260805110100_moderation_review_existence_check.sql,
 * NOT yet pushed) -- deliberately NOT get_story_for_moderator() itself,
 * which builds the entire review payload (content_json, consent snapshot,
 * a jsonb_agg of every attached media item) on every call; reusing it here
 * would mean middleware fetches that whole payload on every request just
 * to decide a 404. Same "error and empty both mean false, no distinction
 * leaked" shape as canReadStoryDraft/canPreviewStory above.
 */
async function canViewModerationReview(
  supabase: ReturnType<typeof createServerClient>,
  revisionId: string,
) {
  const { data, error } = await supabase.rpc("can_view_moderation_review", {
    p_revision_id: revisionId,
  });
  return !error && Array.isArray(data) && data.length > 0;
}

/**
 * Release audit: same shape as canViewModerationReview() above, for
 * /moderation/reports/[id] via can_view_moderation_report()
 * (supabase/migrations/20260806100000_moderation_report_existence_check.sql).
 */
async function canViewModerationReport(
  supabase: ReturnType<typeof createServerClient>,
  reportId: string,
) {
  const { data, error } = await supabase.rpc("can_view_moderation_report", {
    p_report_id: reportId,
  });
  return !error && Array.isArray(data) && data.length > 0;
}

async function publishedStoryExists(
  supabase: ReturnType<typeof createServerClient>,
  slug: string,
) {
  const { data, error } = await supabase.rpc("get_published_story", {
    p_slug: slug,
  });
  return !error && Array.isArray(data) && data.length > 0;
}

async function publicContributorExists(
  supabase: ReturnType<typeof createServerClient>,
  slug: string,
) {
  const { data, error } = await supabase.rpc("get_public_contributor", {
    p_slug: slug,
  });
  return !error && Array.isArray(data) && data.length > 0;
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

    // Role-level check above only proves this user is SOME editor/admin --
    // it says nothing about whether they're the assigned editor for THIS
    // particular story. Prompt 4 Sub-phase 5 live-verified that an editor
    // with no relation to a given story still got a live 200 (a generic
    // error page, from get_my_story_with_draft()'s raised exception) when
    // hitting /editorial/:id/edit directly. See canReadStoryDraft's comment
    // above for the full explanation.
    const editorialEditMatch = request.nextUrl.pathname.match(
      EDITORIAL_EDIT_PAGE_PATH,
    );
    if (editorialEditMatch) {
      const allowed = await canReadStoryDraft(supabase, editorialEditMatch[1]);
      if (!allowed) {
        return flatNotFound();
      }
    }
  }

  if (STAFF_MODERATION_PATH.test(request.nextUrl.pathname)) {
    // Signed-out and signed-in-with-the-wrong-role get the IDENTICAL flat
    // 404, same convention as every other staff route in this app.
    if (!data?.claims?.sub) {
      return flatNotFound();
    }
    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", data.claims.sub)
      .single();
    if (roleRow?.role !== "moderator" && roleRow?.role !== "admin") {
      return flatNotFound();
    }

    // Role-level check above only proves this user is SOME moderator/admin
    // -- it says nothing about whether the specific revision id in the URL
    // actually exists. See canViewModerationReview()'s comment above for
    // why this is a dedicated lightweight RPC rather than
    // get_story_for_moderator() itself.
    const reviewMatch = request.nextUrl.pathname.match(
      MODERATION_REVIEW_PAGE_PATH,
    );
    if (reviewMatch) {
      const allowed = await canViewModerationReview(supabase, reviewMatch[1]);
      if (!allowed) {
        return flatNotFound();
      }
    }

    const reportMatch = request.nextUrl.pathname.match(
      MODERATION_REPORT_PAGE_PATH,
    );
    if (reportMatch) {
      const allowed = await canViewModerationReport(supabase, reportMatch[1]);
      if (!allowed) {
        return flatNotFound();
      }
    }
  }

  if (STAFF_READINESS_PATH.test(request.nextUrl.pathname)) {
    // Signed-out and signed-in-with-the-wrong-role get the IDENTICAL flat
    // 404, same convention as every other staff route in this app.
    if (!data?.claims?.sub) {
      return flatNotFound();
    }
    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", data.claims.sub)
      .single();
    if (
      roleRow?.role !== "editor" &&
      roleRow?.role !== "moderator" &&
      roleRow?.role !== "admin"
    ) {
      return flatNotFound();
    }
  }

  // Prompt 4 Sub-phase 5: per-row authorization for the self-service
  // authoring pages, for the same reason as the editorial per-row check
  // just above. Only runs once we know the visitor is signed in (the
  // sign-in-redirect branch above already returned early otherwise, since
  // both patterns are also covered by PROTECTED_DYNAMIC_STORY_PATH/
  // isProtectedPath).
  if (data?.claims?.sub) {
    const editMatch = request.nextUrl.pathname.match(STORY_EDIT_PAGE_PATH);
    if (editMatch) {
      const allowed = await canReadStoryDraft(supabase, editMatch[1]);
      if (!allowed) {
        return flatNotFound();
      }
    }

    const previewMatch = request.nextUrl.pathname.match(
      STORY_PREVIEW_PAGE_PATH,
    );
    if (previewMatch) {
      const allowed = await canPreviewStory(supabase, previewMatch[1]);
      if (!allowed) {
        return flatNotFound();
      }
    }
  }

  // The preview page can render draft/unpublished content — never cached at
  // any layer, on top of the page itself already opting out via
  // `export const dynamic = "force-dynamic"`.
  if (PREVIEW_PATH.test(request.nextUrl.pathname)) {
    response.headers.set("Cache-Control", "no-store");
  }

  // Public detail pages — see the STORY_DETAIL_PAGE_PATH comment above.
  // "/stories/new" is a real static route, not a slug — excluded
  // explicitly rather than relying on the regex alone, since a signed-in
  // visitor reaches this point without having been redirected above.
  const storyDetailMatch = request.nextUrl.pathname.match(
    STORY_DETAIL_PAGE_PATH,
  );
  if (storyDetailMatch && storyDetailMatch[1] !== "new") {
    const exists = await publishedStoryExists(supabase, storyDetailMatch[1]);
    if (!exists) {
      return publicNotFound();
    }
  }

  const contributorDetailMatch = request.nextUrl.pathname.match(
    CONTRIBUTOR_DETAIL_PAGE_PATH,
  );
  if (contributorDetailMatch) {
    const exists = await publicContributorExists(
      supabase,
      contributorDetailMatch[1],
    );
    if (!exists) {
      return publicNotFound();
    }
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
    "/moderation",
    "/moderation/:path*",
    "/readiness",
    "/readiness/:path*",
    "/stories/:id",
    "/contributors/:slug",
  ],
};
