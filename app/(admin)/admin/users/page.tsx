import type { Metadata } from "next";
import Link from "next/link";
import { listUserAccounts } from "@/lib/admin/user-accounts";
import {
  APP_ROLES,
  parseUserAccountsSearchParams,
  USER_ACCOUNTS_PAGE_SIZE,
} from "@/lib/validation/admin";
import { formatSignIn, ROLE_LABELS } from "@/lib/admin/role-changes";

export const metadata: Metadata = {
  title: "User accounts",
  robots: { index: false, follow: false },
};

// Staff content, and this page renders account emails -- never cached or
// pre-rendered at any layer, same convention as every other staff route.
export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function buildHref(
  base: string,
  raw: SearchParams,
  overrides: Record<string, string | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") params.set(key, value);
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) params.delete(key);
    else params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/**
 * The account list an admin previously had no way to see from the app at
 * all -- profiles' RLS has no admin read policy, and auth.users (where
 * email and last_sign_in_at live) is unreachable from an authenticated
 * client entirely. list_user_accounts() is the admin-gated SECURITY
 * DEFINER function that assembles it.
 *
 * Role changes are NOT made from this list -- they live on each account's
 * own detail page, which is the only place with the full context
 * (linked contributor, story counts, recent staff activity) needed to make
 * that call, and the only place that knows the total admin count.
 */
export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const rawParams = await searchParams;
  const filters = parseUserAccountsSearchParams(rawParams);
  const offset = (filters.page - 1) * USER_ACCOUNTS_PAGE_SIZE;

  let rows: Awaited<ReturnType<typeof listUserAccounts>> = [];
  let loadError = false;
  try {
    rows = await listUserAccounts({
      search: filters.search,
      role: filters.role,
      limit: USER_ACCOUNTS_PAGE_SIZE,
      offset,
    });
  } catch {
    loadError = true;
  }

  const totalCount = rows[0]?.total_count ?? 0;
  const hasNextPage = offset + rows.length < totalCount;
  const hasPrevPage = filters.page > 1;

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        User accounts
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Every account on the platform, with its current role. Open an account to
        see full detail and change its role.
      </p>

      <form
        method="get"
        className="mt-6 grid grid-cols-1 gap-3 rounded-md border border-border-subtle p-4 text-sm sm:grid-cols-3"
      >
        <label className="flex flex-col gap-1 sm:col-span-1">
          Search
          <input
            type="search"
            name="search"
            defaultValue={filters.search ?? ""}
            placeholder="Email or display name"
            className="rounded-md border border-border-subtle px-2 py-1 dark:bg-transparent"
          />
        </label>
        <label className="flex flex-col gap-1">
          Role
          <select
            name="role"
            defaultValue={filters.role ?? ""}
            className="rounded-md border border-border-subtle px-2 py-1 dark:bg-transparent"
          >
            <option value="">Any</option>
            {APP_ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <button
            type="submit"
            className="rounded-md bg-accent px-3 py-1.5 font-medium text-accent-foreground"
          >
            Apply filters
          </button>
        </div>
      </form>

      <div className="mt-8" aria-live="polite">
        {loadError ? (
          <p className="rounded-md border border-border-subtle bg-surface-muted p-6 text-sm">
            Could not load accounts right now. Please try again.
          </p>
        ) : rows.length === 0 ? (
          <p className="rounded-md border border-border-subtle bg-surface-muted p-6 text-sm">
            No accounts match these filters.
          </p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {rows.map((row) => (
              <li
                key={row.user_id}
                className="flex flex-col gap-1 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {row.display_name?.trim() || "No display name"}
                    </span>
                    <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs">
                      {row.role ? ROLE_LABELS[row.role] : "No role"}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-sm text-muted-foreground">
                    {row.email ?? "No email on file"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-4 text-sm">
                  <span className="text-muted-foreground">
                    Last sign-in {formatSignIn(row.last_sign_in_at)}
                  </span>
                  <Link
                    href={`/admin/users/${row.user_id}`}
                    className="underline underline-offset-2"
                  >
                    Open
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-8 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          Page {filters.page}
          {totalCount > 0 ? ` — ${totalCount} accounts` : ""}
        </span>
        <div className="flex gap-3">
          {hasPrevPage && (
            <Link
              href={buildHref("/admin/users", rawParams, {
                page: String(filters.page - 1),
              })}
              className="underline underline-offset-2"
            >
              Previous
            </Link>
          )}
          {hasNextPage && (
            <Link
              href={buildHref("/admin/users", rawParams, {
                page: String(filters.page + 1),
              })}
              className="underline underline-offset-2"
            >
              Next
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
