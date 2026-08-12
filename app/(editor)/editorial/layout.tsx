import { notFound } from "next/navigation";
import { getCurrentUserRole, resolveStaffAccess } from "@/lib/auth/roles";
import { SiteFooter } from "@/components/site-footer";
import { PageTransition } from "@/components/page-transition";
import { EditorialNav } from "./editorial-nav";

/**
 * Prompt 4 Sub-phase 4: /editorial gains a real UI, converting away from
 * the Prompt 1/2 role-gated JSON-stub Route Handler
 * (app/(editor)/editorial/route.ts, removed by this change).
 *
 * docs/architecture.md's "Staff routes" section explains why Prompt 1
 * originally chose a Route Handler over a page: a page-based notFound()
 * can, in general, flush an HTTP 200 shell before the 404 attaches deeper
 * in a streamed render tree. This layout avoids that specific failure mode
 * by doing the ENTIRE role check synchronously at the top of a plain,
 * non-streaming Server Component with no loading.tsx/Suspense boundary
 * anywhere under it -- there is no partial shell to flush before
 * notFound() is decided. This is asserted, not assumed: it must be
 * confirmed with a real `curl -i` request (both signed-out and signed-in-
 * with-the-wrong-role) before this is treated as equivalent to the old
 * Route Handler's guarantee -- see docs/implementation-status.md "Prompt 4
 * Sub-phase 4 detail" for the actual verification result.
 *
 * Anyone without editor/admin gets the identical flat 404 as a signed-out
 * visitor, same as every other staff route in this app -- no information
 * leak about *why* access was denied.
 */
export default async function EditorialLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const role = await getCurrentUserRole();
  const access = resolveStaffAccess(role, ["editor", "admin"]);

  if (!access.ok) {
    notFound();
  }

  return (
    <>
      <EditorialNav />
      <main id="main-content" className="flex-1">
        <PageTransition>{children}</PageTransition>
      </main>
      <SiteFooter />
    </>
  );
}
