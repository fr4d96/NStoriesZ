import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { resolveContributorAccess } from "@/lib/auth/contributor-guard";
import { ContributorNav } from "@/components/contributor-nav";
import { SiteFooter } from "@/components/site-footer";

/**
 * The only place in the app that calls getCurrentUser(). Public layouts
 * never do this, so they stay static/cache-friendly.
 */
export default async function ContributorLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await getCurrentUser();
  const access = resolveContributorAccess(user);

  if (!access.ok) {
    redirect(access.redirectTo);
  }

  return (
    <>
      <ContributorNav />
      <main id="main-content" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
