import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { getCurrentUserRole } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { listPublishedStories, listPublicContributors } from "@/lib/story/public-queries";
import { listMyStories } from "@/lib/story/contributor-queries";
import { listEditorialQueue, getModerationQueue, listReportsForStaff } from "@/lib/story/moderation";
import type { AppRole } from "@/lib/auth/staff-guard";

export const metadata: Metadata = {
  title: "QA Index",
  robots: { index: false, follow: false },
};

// Dev/QA-only route, not linked from any nav. Not in proxy.ts's matcher,
// so it renders regardless of role -- it exists specifically to show what
// each role CAN and CAN'T reach, including the wrong-role cases.
export const dynamic = "force-dynamic";

type LinkRow = {
  label: string;
  href: string | null;
  note?: string;
};

type Section = {
  title: string;
  requirement: string;
  unlocked: boolean;
  links: LinkRow[];
};

async function safe<T>(fn: () => Promise<T[]>): Promise<T[]> {
  try {
    return await fn();
  } catch {
    return [];
  }
}

export default async function QaIndexPage() {
  const user = await getCurrentUser();
  const role = await getCurrentUserRole();

  let email: string | null = null;
  if (user) {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    email = (data?.claims?.email as string | undefined) ?? null;
  }

  const [publishedStories, publicContributors] = await Promise.all([
    safe(() => listPublishedStories({ limit: 1 })),
    safe(() => listPublicContributors({ limit: 1 })),
  ]);

  const exampleStorySlug = publishedStories[0]?.slug as string | undefined;
  const exampleContributorSlug = publicContributors[0]?.public_slug as
    | string
    | undefined;

  const myStories = user ? await safe(() => listMyStories()) : [];
  const myStoryId = myStories[0]?.id as string | undefined;

  const editorialQueue =
    role === "editor" || role === "admin"
      ? await safe(() => listEditorialQueue({ limit: 1 }))
      : [];
  const editorialStoryId = editorialQueue[0]?.story_id as string | undefined;

  const moderationQueue =
    role === "moderator" || role === "admin"
      ? await safe(() => getModerationQueue({ limit: 1 }))
      : [];
  const moderationRevisionId = moderationQueue[0]?.revision_id as
    | string
    | undefined;

  const reports =
    role === "moderator" || role === "admin"
      ? await safe(() => listReportsForStaff({ limit: 1 }))
      : [];
  const exampleReport = reports[0] as
    | { id?: string; story_id?: string }
    | undefined;

  const hasRole = (allowed: AppRole[]) => !!role && allowed.includes(role);

  const sections: Section[] = [
    {
      title: "Public",
      requirement: "Anyone, signed in or not",
      unlocked: true,
      links: [
        { label: "Home", href: "/" },
        { label: "Browse stories", href: "/stories" },
        {
          label: "Story detail",
          href: exampleStorySlug ? `/stories/${exampleStorySlug}` : null,
          note: exampleStorySlug ? undefined : "No published story to link to yet",
        },
        { label: "Browse contributors", href: "/contributors" },
        {
          label: "Contributor profile",
          href: exampleContributorSlug
            ? `/contributors/${exampleContributorSlug}`
            : null,
          note: exampleContributorSlug
            ? undefined
            : "No public contributor profile yet",
        },
        { label: "About", href: "/about" },
        { label: "Community guidelines", href: "/community-guidelines" },
        { label: "Privacy", href: "/privacy" },
        { label: "Terms", href: "/terms" },
        { label: "Copyright", href: "/copyright" },
      ],
    },
    {
      title: "Auth",
      requirement: "Signed out (or any state -- forms just work)",
      unlocked: true,
      links: [
        { label: "Sign in", href: "/sign-in" },
        { label: "Sign up", href: "/sign-up" },
        { label: "Forgot password", href: "/forgot-password" },
        { label: "Reset password", href: "/reset-password" },
      ],
    },
    {
      title: "Contributor",
      requirement: "Any signed-in account (user, editor, moderator, admin)",
      unlocked: !!user,
      links: [
        { label: "Account settings", href: user ? "/account" : null },
        { label: "My stories", href: user ? "/my-stories" : null },
        { label: "Start a new story", href: user ? "/stories/new" : null },
        {
          label: "Edit a story",
          href: myStoryId ? `/stories/${myStoryId}/edit` : null,
          note: !user
            ? undefined
            : myStoryId
              ? undefined
              : "This account has no stories yet -- start one first",
        },
        {
          label: "Preview a story",
          href: myStoryId ? `/stories/${myStoryId}/preview` : null,
          note: !user
            ? undefined
            : myStoryId
              ? undefined
              : "This account has no stories yet -- start one first",
        },
      ],
    },
    {
      title: "Editorial",
      requirement: "editor or admin",
      unlocked: hasRole(["editor", "admin"]),
      links: [
        { label: "Editorial dashboard", href: hasRole(["editor", "admin"]) ? "/editorial" : null },
        { label: "Prepare a new story", href: hasRole(["editor", "admin"]) ? "/editorial/new" : null },
        { label: "Contributor prep", href: hasRole(["editor", "admin"]) ? "/editorial/contributors" : null },
        {
          label: "Edit an assigned story",
          href: editorialStoryId ? `/editorial/${editorialStoryId}/edit` : null,
          note: !hasRole(["editor", "admin"])
            ? undefined
            : editorialStoryId
              ? undefined
              : "No story currently assigned to this account",
        },
      ],
    },
    {
      title: "Moderation",
      requirement: "moderator or admin",
      unlocked: hasRole(["moderator", "admin"]),
      links: [
        { label: "Moderation queue", href: hasRole(["moderator", "admin"]) ? "/moderation" : null },
        { label: "Stories queue", href: hasRole(["moderator", "admin"]) ? "/moderation/stories" : null },
        {
          label: "Review a story",
          href: moderationRevisionId
            ? `/moderation/stories/${moderationRevisionId}`
            : null,
          note: !hasRole(["moderator", "admin"])
            ? undefined
            : moderationRevisionId
              ? undefined
              : "Nothing in the moderation queue right now",
        },
        { label: "Reports triage", href: hasRole(["moderator", "admin"]) ? "/moderation/reports" : null },
        {
          label: "Report detail",
          href:
            exampleReport?.id && exampleReport?.story_id
              ? `/moderation/reports/${exampleReport.id}?storyId=${exampleReport.story_id}`
              : null,
          note: !hasRole(["moderator", "admin"])
            ? undefined
            : exampleReport
              ? undefined
              : "No open reports right now",
        },
      ],
    },
    {
      title: "Readiness",
      requirement: "editor, moderator, or admin",
      unlocked: hasRole(["editor", "moderator", "admin"]),
      links: [
        {
          label: "Content-readiness dashboard",
          href: hasRole(["editor", "moderator", "admin"]) ? "/readiness" : null,
        },
      ],
    },
  ];

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <h1 className="journiq-heading text-[2.4rem]">QA Index</h1>
      <p className="mt-2 text-foreground/65">
        Every route in the app, grouped by who can reach it. Locked sections
        show why they&apos;re locked for the current session instead of a
        link. Sign in as a different account and reload to test another role.
      </p>

      <div className="mt-6 rounded-md border border-border-subtle bg-surface-muted p-4 text-sm">
        {user ? (
          <p>
            Signed in as <span className="font-medium">{email ?? user.id}</span>{" "}
            &mdash; role: <span className="font-medium">{role ?? "none"}</span>
          </p>
        ) : (
          <p>Signed out.</p>
        )}
        <p className="mt-2 text-foreground/65">
          Dev accounts:{" "}
          <code>dev-user@example.com</code> /{" "}
          <code>dev-moderator@example.com</code> /{" "}
          <code>dev-admin@example.com</code> &mdash; use the password you were
          given when they were created.{" "}
          <Link href="/sign-in" className="text-accent underline underline-offset-2">
            Sign in
          </Link>
          {user ? (
            <>
              {" "}or use the account menu in the site header to sign out.
            </>
          ) : null}
        </p>
      </div>

      <div className="mt-10 flex flex-col gap-10">
        {sections.map((section) => (
          <section key={section.title}>
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="journiq-heading text-xl">{section.title}</h2>
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${
                  section.unlocked
                    ? "bg-fern/15 text-fern"
                    : "bg-surface-muted text-foreground/45"
                }`}
              >
                {section.unlocked ? "Unlocked" : "Locked"} &middot; requires{" "}
                {section.requirement}
              </span>
            </div>
            <ul className="mt-4 divide-y divide-border-subtle rounded-md border border-border-subtle">
              {section.links.map((link) => (
                <li
                  key={link.label}
                  className="flex items-center justify-between gap-4 px-4 py-3"
                >
                  <div>
                    <p className="font-medium">{link.label}</p>
                    {link.note ? (
                      <p className="text-xs text-foreground/55">{link.note}</p>
                    ) : null}
                  </div>
                  {link.href ? (
                    <Link
                      href={link.href}
                      className="journiq-button bg-accent text-accent-foreground shrink-0"
                    >
                      Open
                    </Link>
                  ) : (
                    <span className="shrink-0 text-xs text-foreground/45">
                      Not available
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
