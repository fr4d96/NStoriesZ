import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { countAdmins, getUserAccountDetail } from "@/lib/admin/user-accounts";
import {
  buildRoleOptions,
  formatSignIn,
  parseActivity,
  ROLE_LABELS,
} from "@/lib/admin/role-changes";
import { RoleForm } from "./role-form";

export const metadata: Metadata = {
  title: "Account detail",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 break-words text-sm">{value}</dd>
    </div>
  );
}

/**
 * Full account detail. get_user_account_detail() returns zero rows for an
 * id that does not exist or has been soft-deleted, which becomes the same
 * flat 404 as any other unknown route -- an admin probing ids learns
 * nothing from the difference. A raised exception (only possible if the
 * caller is somehow not an admin, which the layout and proxy.ts have both
 * already rejected) is caught into the identical 404 rather than a stack
 * trace.
 */
export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let detail: Awaited<ReturnType<typeof getUserAccountDetail>> = null;
  let adminCount = 0;
  try {
    [detail, adminCount] = await Promise.all([
      getUserAccountDetail(id),
      countAdmins(),
    ]);
  } catch {
    notFound();
  }

  if (!detail) {
    notFound();
  }

  // The acting admin's own id, re-derived server-side from the session --
  // never taken from the page/props -- so the self-demotion mirror cannot
  // be steered by a crafted request (Engineering Rule 2).
  const viewerUserId = (await getCurrentUser())?.id ?? "";

  const roleOptions = buildRoleOptions({
    viewerUserId,
    targetUserId: detail.user_id,
    targetRole: detail.role,
    adminCount,
  });
  const activity = parseActivity(detail.recent_activity);

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
      <Link
        href="/admin/users"
        className="text-sm underline underline-offset-2"
      >
        ← All accounts
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">
        {detail.display_name?.trim() || "No display name"}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {detail.email ?? "No email on file"}
      </p>

      <section className="mt-8 rounded-md border border-border-subtle p-4 sm:p-6">
        <h2 className="text-lg font-medium">Account</h2>
        <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Role"
            value={detail.role ? ROLE_LABELS[detail.role] : "No role"}
          />
          <Field
            label="Signed up"
            value={new Date(detail.created_at).toLocaleString("en-NZ")}
          />
          <Field
            label="Last sign-in"
            value={formatSignIn(detail.last_sign_in_at)}
          />
          <Field
            label="Email confirmed"
            value={formatSignIn(detail.email_confirmed_at)}
          />
          <Field
            label="Role last changed"
            value={formatSignIn(detail.role_updated_at)}
          />
          <Field
            label="Public profile"
            value={
              detail.public_profile_enabled
                ? `Enabled${detail.public_slug ? ` (/${detail.public_slug})` : ""}`
                : "Disabled"
            }
          />
        </dl>
      </section>

      <section className="mt-6 rounded-md border border-border-subtle p-4 sm:p-6">
        <h2 className="text-lg font-medium">Role</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Changes go through <code>admin_set_user_role()</code>, the only
          sanctioned write path into roles. It re-checks your own admin status
          server-side and refuses any change that would leave no admins.
        </p>
        <RoleForm userId={detail.user_id} options={roleOptions} />
      </section>

      <section className="mt-6 rounded-md border border-border-subtle p-4 sm:p-6">
        <h2 className="text-lg font-medium">Contribution</h2>
        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label="Stories owned" value={String(detail.stories_owned)} />
          <Field label="Published" value={String(detail.stories_published)} />
          <Field
            label="Assigned as editor"
            value={String(detail.stories_assigned_as_editor)}
          />
          <Field
            label="Contributor identity"
            value={detail.contributor_display_name ?? "None"}
          />
        </dl>
      </section>

      <section className="mt-6 rounded-md border border-border-subtle p-4 sm:p-6">
        <h2 className="text-lg font-medium">Recent staff activity</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The 10 most recent moderation decisions and editorial actions by this
          account. Reasons and internal notes are not shown here — they live on
          each story&rsquo;s own review page.
        </p>
        {activity.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            No staff activity recorded.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border-subtle text-sm">
            {activity.map((entry, index) => (
              <li
                key={`${entry.kind}-${entry.story_id}-${entry.created_at}-${index}`}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <span>
                  <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs">
                    {entry.kind === "moderation" ? "Moderation" : "Editorial"}
                  </span>{" "}
                  {entry.label}
                  {entry.story_slug ? ` — ${entry.story_slug}` : ""}
                </span>
                <span className="text-muted-foreground">
                  {new Date(entry.created_at).toLocaleString("en-NZ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
