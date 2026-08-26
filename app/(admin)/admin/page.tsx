import type { Metadata } from "next";
import Link from "next/link";
import { getOperationalMetrics } from "@/lib/story/readiness";
import {
  listUserAccounts,
  type UserAccountRow,
} from "@/lib/admin/user-accounts";
import { APP_ROLES } from "@/lib/validation/admin";
import { sumCounts } from "@/lib/story/moderation-analytics";
import {
  ROLE_LABELS,
  accountLabel,
  buildPipelineStages,
  buildPublicationBlockers,
  countStaff,
  emptyRoleCounts,
  isLastAdminStanding,
  summarizeRoleDistribution,
  type RoleCounts,
} from "@/lib/admin/dashboard-analytics";
import {
  AgeStackedBar,
  BarList,
  DataTable,
  Panel,
  SectionHeading,
  StatTile,
} from "@/app/(moderation)/moderation/dashboard-charts";

/**
 * Admin tooling Phase 2. This replaces the placeholder Route Handler that
 * used to sit at app/(admin)/admin/route.ts and answered `{"ok":true,
 * "message":"Admin tooling is not built yet."}` -- a page and a Route
 * Handler cannot share a segment, so the handler is gone rather than
 * kept alongside.
 *
 * Access is unchanged and still fails closed to a FLAT 404 for anyone
 * without the admin role, never a "forbidden" that would confirm the route
 * exists: proxy.ts's STAFF_ADMIN_PATH produces the real 404 status, and
 * app/(admin)/admin/layout.tsx re-checks resolveStaffAccess(role,
 * ["admin"]) as the defense-in-depth backstop. Nothing in this file needs
 * its own role check, and adding one would only duplicate the layout's.
 *
 * NO NEW DATABASE SURFACE. Every figure comes from two RPCs that already
 * existed and were already gated: get_operational_metrics()
 * (editor/moderator/admin, since 20260806090000) and list_user_accounts()
 * (admin only, Phase 1). Derivations are pure and live in
 * lib/admin/dashboard-analytics.ts; the charts are the /moderation
 * primitives, reused rather than reimplemented -- same "plain HTML+CSS
 * Server Components, no charting dependency, no client JS" precedent set
 * on 2026-08-22.
 */

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

// Staff content, always the caller's own current view -- never cached or
// pre-rendered, same convention as /moderation and /editorial.
export const dynamic = "force-dynamic";

const RECENT_ACCOUNTS = 5;

type AccountsSnapshot = {
  counts: RoleCounts;
  total: number;
  recent: UserAccountRow[];
};

/**
 * Role mix and the newest accounts, from list_user_accounts() alone.
 *
 * Five one-row-ish queries rather than one new counting RPC, because Phase
 * 2 adds no migration: the function already returns `count(*) over ()` as
 * `total_count`, so a `p_limit` of 1 with a role filter reads that role's
 * genuine TOTAL, not a page size -- exactly the trick countAdmins()
 * already uses. The unfiltered call is what supplies both the account
 * total and the recent list, so it is the only one that fetches real rows.
 */
async function loadAccounts(): Promise<AccountsSnapshot> {
  const [unfiltered, ...byRole] = await Promise.all([
    listUserAccounts({ limit: RECENT_ACCOUNTS, offset: 0 }),
    ...APP_ROLES.map((role) => listUserAccounts({ role, limit: 1, offset: 0 })),
  ]);

  const counts = emptyRoleCounts();
  APP_ROLES.forEach((role, index) => {
    counts[role] = byRole[index][0]?.total_count ?? 0;
  });

  return {
    counts,
    total: unfiltered[0]?.total_count ?? 0,
    // list_user_accounts() orders by created_at desc, so the first page IS
    // the newest accounts -- no client-side sort needed or wanted.
    recent: unfiltered,
  };
}

function formatJoined(iso: string): string {
  return new Date(iso).toLocaleDateString("en-NZ", { dateStyle: "medium" });
}

/** A link out to another staff surface, with what it is actually for. */
function SurfaceCard({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-xl border border-border-subtle bg-surface p-4 transition-transform hover:-translate-y-0.5 hover:shadow-md"
    >
      <span className="block font-bold">{title}</span>
      <span className="mt-1 block text-sm text-muted-foreground">
        {description}
      </span>
    </Link>
  );
}

export default async function AdminOverviewPage() {
  const now = new Date();

  // Two independent trust surfaces with two different gates, so they get
  // two independent failure flags: an admin-only RPC failing must not blank
  // the staff-wide catalogue figures, and vice versa.
  let metrics: Awaited<ReturnType<typeof getOperationalMetrics>> = null;
  let metricsError = false;
  let accounts: AccountsSnapshot = {
    counts: emptyRoleCounts(),
    total: 0,
    recent: [],
  };
  let accountsError = false;

  const [metricsResult, accountsResult] = await Promise.allSettled([
    getOperationalMetrics(),
    loadAccounts(),
  ]);

  if (metricsResult.status === "fulfilled") {
    metrics = metricsResult.value;
  } else {
    metricsError = true;
  }
  if (accountsResult.status === "fulfilled") {
    accounts = accountsResult.value;
  } else {
    accountsError = true;
  }

  const pipeline = buildPipelineStages(metrics);
  const pipelineTotal = sumCounts(pipeline);
  const blockers = buildPublicationBlockers(metrics);
  const roleMix = summarizeRoleDistribution(accounts.counts, accounts.total);
  const staff = countStaff(accounts.counts);
  const lastAdmin = isLastAdminStanding(accounts.counts);

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
      <header>
        <p className="font-mono text-[0.625rem] tracking-[0.18em] text-muted-foreground uppercase">
          As of{" "}
          <time dateTime={now.toISOString()}>
            {now.toLocaleString("en-NZ", {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </time>
        </p>
        <h1 className="mt-2 text-2xl font-extrabold tracking-[-.03em] sm:text-3xl">
          Admin
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Who has access, and where the catalogue is up to. Aggregate counts
          only — no per-contributor or per-moderator breakdown, and no email
          addresses on this page.
        </p>
      </header>

      {metricsError && accountsError ? (
        <p className="mt-8 rounded-xl border border-border-subtle bg-surface-muted p-6 text-sm">
          Could not load admin figures right now.{" "}
          <Link href="/admin/users" className="underline underline-offset-2">
            User accounts
          </Link>{" "}
          and{" "}
          <Link href="/moderation" className="underline underline-offset-2">
            moderation
          </Link>{" "}
          are still available.
        </p>
      ) : null}

      <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Accounts"
          value={accountsError ? "—" : String(accounts.total)}
          hint={
            accountsError
              ? "Could not read account figures"
              : `${staff} with a staff role`
          }
          href="/admin/users"
        />
        <StatTile
          label="Admins"
          value={accountsError ? "—" : String(accounts.counts.admin)}
          hint={
            accountsError
              ? "Could not read account figures"
              : lastAdmin
                ? "Promote a second admin before demoting anyone"
                : "Can change roles and reach every staff surface"
          }
          tone={!accountsError && lastAdmin ? "critical" : "default"}
          href="/admin/users?role=admin"
        />
        <StatTile
          label="Published"
          value={metricsError ? "—" : String(metrics?.published_count ?? 0)}
          hint={
            metricsError ? "Could not read catalogue figures" : "Live stories"
          }
        />
        <StatTile
          label="In the pipeline"
          value={metricsError ? "—" : String(pipelineTotal)}
          hint={
            metricsError
              ? "Could not read catalogue figures"
              : pipelineTotal === 0
                ? "Nothing in flight"
                : "Unpublished and moving"
          }
          tone={!metricsError && pipelineTotal > 0 ? "accent" : "default"}
          href="/readiness"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel className="flex flex-col">
          <SectionHeading
            title="Catalogue pipeline"
            description="Where unpublished work is sitting, in the order a story moves through it."
            action={{ href: "/readiness", label: "Content readiness" }}
          />
          {metricsError ? (
            <p className="mt-5 text-sm text-muted-foreground">
              Could not read catalogue figures right now.
            </p>
          ) : pipelineTotal === 0 ? (
            <p className="mt-5 text-sm text-muted-foreground">
              Nothing is in flight — every story is either published or has not
              been started.
            </p>
          ) : (
            <>
              <div className="mt-5">
                <AgeStackedBar
                  buckets={pipeline}
                  caption="Unpublished stories by the stage they are waiting at."
                  describeTotal={(total) =>
                    `${total} unpublished stories by stage`
                  }
                  emptyLabel="Nothing is in flight."
                />
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                Drafts counted here are editorial imports only — a
                self-submitted draft that has never been submitted appears in no
                stage, because the operational-metrics function does not count
                one.
              </p>
            </>
          )}
          <DataTable
            summary="Show as table"
            columns={["Stage", "Stories"]}
            rows={pipeline.map((stage) => ({
              key: stage.key,
              label: stage.label,
              count: stage.count,
            }))}
          />
        </Panel>

        <Panel className="flex flex-col">
          <SectionHeading
            title="Who has access"
            description="Every account by the role it currently holds."
            action={{ href: "/admin/users", label: "Manage users" }}
          />
          <div className="mt-5">
            {accountsError ? (
              <p className="text-sm text-muted-foreground">
                Could not read account figures right now.
              </p>
            ) : (
              <BarList
                items={roleMix}
                emptyLabel="No accounts yet."
                ariaLabel="Accounts by role"
              />
            )}
          </div>
          {!accountsError && lastAdmin ? (
            <p className="mt-4 text-xs text-destructive">
              Only one admin account exists. The database refuses any change
              that would leave zero, so that account cannot be demoted until
              another admin is promoted.
            </p>
          ) : null}
          <DataTable
            summary="Show as table"
            columns={["Role", "Accounts"]}
            rows={roleMix.map((slice) => ({
              key: slice.key,
              label: slice.label,
              count: slice.count,
            }))}
          />
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel className="flex flex-col">
          <SectionHeading
            title="Needs attention"
            description="Signals that hold a story back from publication, or pull it back after."
            action={{ href: "/moderation", label: "Moderation" }}
          />
          <div className="mt-5">
            {metricsError ? (
              <p className="text-sm text-muted-foreground">
                Could not read catalogue figures right now.
              </p>
            ) : (
              <BarList
                items={blockers}
                emptyLabel="Nothing outstanding."
                ariaLabel="Outstanding publication signals"
              />
            )}
          </div>
          <DataTable
            summary="Show as table"
            columns={["Signal", "Count"]}
            rows={blockers.map((blocker) => ({
              key: blocker.key,
              label: blocker.label,
              count: blocker.count,
            }))}
          />
        </Panel>

        <Panel className="flex flex-col">
          <SectionHeading
            title="Recently joined"
            description={`The ${RECENT_ACCOUNTS} newest accounts, by sign-up date.`}
            action={{ href: "/admin/users", label: "All accounts" }}
          />
          {accountsError ? (
            <p className="mt-5 text-sm text-muted-foreground">
              Could not read account figures right now.
            </p>
          ) : accounts.recent.length === 0 ? (
            <p className="mt-5 text-sm text-muted-foreground">
              No accounts yet.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-border-subtle">
              {accounts.recent.map((account) => (
                <li
                  key={account.user_id}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/admin/users/${account.user_id}`}
                      className="font-bold underline-offset-4 hover:underline"
                    >
                      {accountLabel(account)}
                    </Link>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                      Joined {formatJoined(account.created_at)}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-tag-background px-2 py-0.5 font-mono text-xs text-tag-foreground">
                    {account.role ? ROLE_LABELS[account.role] : "No role"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <section className="mt-4">
        <SectionHeading
          title="Admin surfaces"
          description="Everything an admin can reach from here."
        />
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SurfaceCard
            href="/admin/users"
            title="Users"
            description="List accounts, read one in full, and change a role."
          />
          <SurfaceCard
            href="/moderation"
            title="Moderation"
            description="Approve or reject submitted revisions, and triage reader reports."
          />
          <SurfaceCard
            href="/editorial"
            title="Editorial"
            description="Import and prepare contributor stories before they are submitted."
          />
          <SurfaceCard
            href="/readiness"
            title="Readiness"
            description="Per-story checklist of what is still missing before launch."
          />
        </div>
      </section>
    </div>
  );
}
