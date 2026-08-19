import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { getCurrentUserRole } from "@/lib/auth/roles";
import { ProfileForm } from "@/app/(contributor)/account/profile-form";
import { ContributorForm } from "@/app/(contributor)/account/contributor-form";
import { SignOutButton } from "@/app/(contributor)/account/sign-out-button";

export const metadata: Metadata = {
  title: "Account",
};

/**
 * Enforced signed-in by the (contributor) layout already — this page only
 * needs to read the caller's own rows, which RLS scopes to auth.uid() on
 * every table it touches (never a client-supplied id).
 */
export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) {
    return null;
  }

  const supabase = await createClient();
  const [{ data: profile }, { data: contributor }, role] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "display_name, bio, home_country_code, public_profile_enabled, public_slug, avatar_emoji",
      )
      .eq("id", user.id)
      .single(),
    supabase
      .from("contributors")
      .select("display_name, attribution_type, public_status, public_slug")
      .eq("linked_user_id", user.id)
      .maybeSingle(),
    getCurrentUserRole(),
  ]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
      <div className="flex items-center justify-between gap-4">
        <h1 className="journiq-heading text-[2.4rem]">Account</h1>
        <SignOutButton />
      </div>

      {role && (
        <p className="mt-2 text-sm text-foreground/60">
          Role: <span className="font-bold">{role}</span>
        </p>
      )}

      {/* A brand new account has no contributor identity yet, and the first
          sign-in is routed straight here for that reason (see
          lib/auth/post-login-redirect.ts). The prompt is driven by the real
          absence of the row, not by a one-shot query parameter, so it also
          catches anyone who skipped the step and came back later. */}
      {!contributor && (
        <div className="mt-6 rounded-md border border-border-subtle bg-surface-muted p-4 text-sm">
          <p className="font-medium">Set your contributor identity to start</p>
          <p className="mt-1 text-foreground/70">
            It&apos;s how your stories are attributed, and you need one before
            you can publish.{" "}
            <a
              href="#contributor-identity"
              className="underline underline-offset-2"
            >
              Set it up below
            </a>
            .
          </p>
        </div>
      )}

      <section className="mt-10">
        <h2 className="font-[Georgia,'Times_New_Roman',serif] text-xl tracking-tight">
          Profile
        </h2>
        <p className="mt-1 text-sm text-foreground/65">
          Nothing here is public unless you enable it below.
        </p>
        <ProfileForm
          displayName={profile?.display_name ?? ""}
          bio={profile?.bio ?? ""}
          homeCountryCode={profile?.home_country_code ?? "MY"}
          publicProfileEnabled={profile?.public_profile_enabled ?? false}
          publicSlug={profile?.public_slug ?? ""}
          avatarEmoji={profile?.avatar_emoji ?? ""}
        />
      </section>

      <section
        id="contributor-identity"
        className="mt-10 scroll-mt-24 border-t border-border-subtle pt-10"
      >
        <h2 className="font-[Georgia,'Times_New_Roman',serif] text-xl tracking-tight">
          Contributor identity
        </h2>
        <p className="mt-1 text-sm text-foreground/65">
          This is how you&apos;ll be attributed on any story you write. You
          choose this — it&apos;s never inferred from your account.
        </p>
        <ContributorForm
          existing={
            contributor
              ? {
                  displayName: contributor.display_name,
                  attributionType: contributor.attribution_type,
                  publicProfileEnabled: contributor.public_status === "public",
                  publicSlug: contributor.public_slug ?? "",
                }
              : null
          }
        />
      </section>
    </div>
  );
}
