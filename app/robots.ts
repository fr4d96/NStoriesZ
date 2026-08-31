import type { MetadataRoute } from "next";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        // Authenticated contributor surfaces (Prompt 4).
        "/my-stories",
        "/stories/new",
        "/stories/*/edit",
        "/stories/*/preview",
        "/account",
        // Auth flows -- never useful to index, and some carry a `next`
        // query param that shouldn't be crawled/cached.
        "/sign-in",
        "/sign-up",
        "/forgot-password",
        "/reset-password",
        "/auth/callback",
        // Staff-only surfaces -- fail closed with a real 404 regardless
        // (proxy.ts), but excluded here too so a crawler never even tries.
        //
        // Every entry here is a PREFIX match, so "/moderation" already covers
        // /moderation/stories/:id and "/admin" already covers /admin/users/:id
        // -- no "/*" variant is needed for any of them. ("/editorial/*" below
        // is therefore redundant with "/editorial"; kept only to avoid
        // pointless churn. Don't copy that shape onto new entries.)
        "/editorial",
        "/editorial/*",
        "/moderation",
        "/admin",
        // /readiness (the content-readiness dashboard, reachable by editor,
        // moderator or admin) was missing from this list entirely -- every
        // other staff route group was here. Same reasoning as the rest: the
        // route already 404s for anyone without one of those roles, this just
        // stops a crawler trying in the first place.
        "/readiness",
      ],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
