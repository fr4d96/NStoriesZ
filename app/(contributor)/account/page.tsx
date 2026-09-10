import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { AccountTabs } from "@/app/(contributor)/account/account-tabs";
import { ProfileForm } from "@/app/(contributor)/account/profile-form";
import { UsernameForm } from "@/app/(contributor)/account/username-form";
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
  const [{ data: profile }, { data: contributor }, { data: usernameRow }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("display_name")
        .eq("id", user.id)
        .single(),
      supabase
        .from("contributors")
        .select(
          "display_name, attribution_type, public_status, public_slug, bio, home_country_code, avatar_emoji",
        )
        .eq("linked_user_id", user.id)
        .maybeSingle(),
      // The caller's OWN username row only. RLS ("usernames: owner reads
      // own username") scopes this to auth.uid() regardless of the filter,
      // and the table has no anon grant at all, so nobody else's username
      // is reachable from here or anywhere else.
      supabase
        .from("usernames")
        .select("username")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);

  const currentUsername = usernameRow?.username ?? "";

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
      <div className="flex items-center justify-between gap-4">
        <h1 className="journiq-heading text-[2.4rem]">Account</h1>
        <SignOutButton />
      </div>

      {/* A brand new account has no contributor identity yet, and the first
          sign-in is routed straight here for that reason (see
          lib/auth/post-login-redirect.ts). The prompt is driven by the real
          absence of the row, not by a one-shot query parameter, so it also
          catches anyone who skipped the step and came back later. The link
          stays a plain #hash anchor: AccountTabs watches hashchange, so it
          opens the tab rather than needing to reach into its state. */}
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
              Open the Contributor identity tab
            </a>
            .
          </p>
        </div>
      )}

      <AccountTabs
        tabs={[
          {
            id: "profile",
            label: "Profile",
            description:
              "Your account settings. None of this is shown to readers.",
            panel: <ProfileForm displayName={profile?.display_name ?? ""} />,
          },
          {
            id: "sign-in",
            label: "Sign-in",
            description:
              "Optional. Set a username and you can sign in with either it or your email — your email keeps working either way.",
            panel: <UsernameForm username={currentUsername} />,
          },
          {
            id: "contributor-identity",
            label: "Contributor identity",
            description:
              "How you're attributed on every story, and what readers see on your contributor page. You choose this — it's never inferred from your account.",
            panel: (
              <ContributorForm
                existing={
                  contributor
                    ? {
                        displayName: contributor.display_name,
                        attributionType: contributor.attribution_type,
                        publicProfileEnabled:
                          contributor.public_status === "public",
                        publicSlug: contributor.public_slug ?? "",
                        bio: contributor.bio ?? "",
                        homeCountryCode: contributor.home_country_code ?? "",
                        avatarEmoji: contributor.avatar_emoji ?? "",
                      }
                    : null
                }
              />
            ),
          },
        ]}
      />
    </div>
  );
}
