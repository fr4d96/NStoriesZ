import { notFound } from "next/navigation";
import { getCurrentUserRole, resolveStaffAccess } from "@/lib/auth/roles";
import { SiteFooter } from "@/components/site-footer";
import { PageTransition } from "@/components/page-transition";
import { AdminNav } from "./admin-nav";

/**
 * Admin tooling Phase 1: /admin/users gains real pages. The Route Handler
 * at app/(admin)/admin/route.ts stays exactly as it is -- /admin itself is
 * still a stub until Phase 2 builds the dashboard, and a Route Handler and
 * this layout coexist fine (a layout only ever wraps child PAGE segments).
 *
 * Same pattern as app/(editor)/editorial/layout.tsx and
 * app/(moderation)/moderation/layout.tsx: the ENTIRE role check happens
 * synchronously at the top of a plain, non-streaming Server Component with
 * no loading.tsx/Suspense boundary under it, so there is no partial shell
 * that could flush an HTTP 200 before notFound() attaches. As with those
 * two, this is a defense-in-depth backstop only -- proxy.ts's
 * STAFF_ADMIN_PATH check is what actually produces the true 404 status,
 * because a page-based notFound() deep in an RSC tree was confirmed live
 * to still return 200 for /editorial's equivalent case.
 *
 * Anyone without admin gets the identical flat 404 as a signed-out
 * visitor -- no information leak about *why* access was denied, and in
 * particular no signal that an admin area exists here at all.
 */
export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const role = await getCurrentUserRole();
  const access = resolveStaffAccess(role, ["admin"]);

  if (!access.ok) {
    notFound();
  }

  return (
    <>
      <AdminNav />
      <main id="main-content" className="flex-1">
        <PageTransition>{children}</PageTransition>
      </main>
      <SiteFooter />
    </>
  );
}
