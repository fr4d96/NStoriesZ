import { notFound } from "next/navigation";
import { getCurrentUserRole, resolveStaffAccess } from "@/lib/auth/roles";
import { SiteFooter } from "@/components/site-footer";
import { PageTransition } from "@/components/page-transition";
import { ReadinessNav } from "./readiness-nav";

/**
 * Prompt 7: /readiness, the content-readiness dashboard + operational
 * metrics. Reachable by editor, moderator, OR admin -- readiness spans both
 * editorial prep and moderation state, so it doesn't cleanly belong to only
 * one role's existing workspace (app/(editor)/editorial/ or
 * app/(moderation)/moderation/).
 *
 * Same defense-in-depth split as every other staff route group: this
 * layout's notFound() call is a backstop, but proxy.ts's STAFF_READINESS_PATH
 * check is what actually produces a true HTTP 404 (a page-based notFound()
 * deep in a streamed RSC tree does not reliably set the response's real
 * status in this app's current Next.js/Turbopack setup -- documented
 * repeatedly in docs/architecture.md's "Staff routes" section).
 */
export default async function ReadinessLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const role = await getCurrentUserRole();
  const access = resolveStaffAccess(role, ["editor", "moderator", "admin"]);

  if (!access.ok) {
    notFound();
  }

  return (
    <>
      <ReadinessNav />
      <main id="main-content" className="flex-1">
        <PageTransition>{children}</PageTransition>
      </main>
      <SiteFooter />
    </>
  );
}
