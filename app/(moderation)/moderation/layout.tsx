import { notFound } from "next/navigation";
import { getCurrentUserRole, resolveStaffAccess } from "@/lib/auth/roles";
import { SiteFooter } from "@/components/site-footer";
import { ModerationNav } from "./moderation-nav";

/**
 * Prompt 6 Stage 2: /moderation gains real pages, replacing the Prompt 1/2
 * role-gated JSON-stub Route Handler (app/(moderation)/moderation/route.ts,
 * removed by this change — a Route Handler and a page cannot coexist at the
 * same route segment).
 *
 * Same pattern as app/(editor)/editorial/layout.tsx: the ENTIRE role check
 * happens synchronously at the top of a plain, non-streaming Server
 * Component with no loading.tsx/Suspense boundary under it, so there is no
 * partial shell that could flush an HTTP 200 before notFound() attaches.
 * This is still only a defense-in-depth backstop — proxy.ts's
 * STAFF_MODERATION_PATH check (which runs before any RSC streaming and can
 * set a real response status directly) is what actually guarantees the
 * true 404 for a signed-out or wrong-role visitor; see proxy.ts's own
 * comment for why a page-based notFound() alone was previously confirmed
 * live to still return 200 for /editorial's equivalent case.
 *
 * Anyone without moderator/admin gets the identical flat 404 as a
 * signed-out visitor — no information leak about *why* access was denied.
 */
export default async function ModerationLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const role = await getCurrentUserRole();
  const access = resolveStaffAccess(role, ["moderator", "admin"]);

  if (!access.ok) {
    notFound();
  }

  return (
    <>
      <ModerationNav />
      <main id="main-content" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
