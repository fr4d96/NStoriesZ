import type { MetadataRoute } from "next";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

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
        "/editorial",
        "/editorial/*",
        "/moderation",
        "/admin",
      ],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
