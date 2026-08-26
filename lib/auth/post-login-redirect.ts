import type { AppRole } from "@/lib/auth/staff-guard";

/**
 * Where a signed-in user lands when nothing more specific was requested
 * (e.g. they navigated straight to /sign-in, rather than being bounced
 * here from a protected page with a real `?next=`). Staff roles land on
 * their own dashboard instead of the ordinary contributor pages. Admin has
 * its own since Phase 2 (app/(admin)/admin/page.tsx) and goes there --
 * before that it deliberately fell back to /moderation, because the only
 * thing at /admin was a placeholder Route Handler returning JSON. The
 * /admin overview links out to every other staff surface an admin can
 * reach, so nothing is lost by no longer landing them on /moderation.
 * An ordinary user (or a signed-in caller whose role lookup came back null)
 * lands on My Stories, not the account settings page.
 */
export function defaultPathForRole(role: AppRole | null): string {
  switch (role) {
    case "admin":
      return "/admin";
    case "moderator":
      return "/moderation";
    case "editor":
      return "/editorial";
    default:
      return "/my-stories";
  }
}

/**
 * The account page, anchored at the contributor-identity section. A brand
 * new account has no contributor identity yet, and every authoring surface
 * depends on one (it is how a story is attributed, and it is never inferred
 * from the account -- see app/(contributor)/account/contributor-form.tsx),
 * so the first sign-in lands there instead of on an empty My Stories.
 */
export const CONTRIBUTOR_SETUP_PATH = "/account#contributor-identity";

/**
 * Pure decision for "where does this sign-in land," given the caller's role
 * and whether they already have a contributor identity. Staff roles are
 * unaffected -- they go to their own dashboard, which never depends on a
 * contributor identity. Only the ordinary-contributor default is split:
 * first sign-in (no identity yet) -> set it up; every later sign-in ->
 * My Stories, exactly as before.
 *
 * The identity flag is passed in rather than read here so this stays a pure,
 * directly-testable function; lib/auth/contributor-identity.ts#resolveSignInLandingPath
 * is the server-side wrapper that supplies it (and only queries for it when
 * the role-based answer is the contributor default).
 */
export function landingPathAfterSignIn(
  role: AppRole | null,
  hasContributorIdentity: boolean,
): string {
  const rolePath = defaultPathForRole(role);
  if (rolePath !== "/my-stories") return rolePath;
  return hasContributorIdentity ? "/my-stories" : CONTRIBUTOR_SETUP_PATH;
}
