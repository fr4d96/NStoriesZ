import { z } from "zod";

// Admin tooling (Phase 1) trust boundaries: the /admin/users query string
// and the one Server Action that can change a role. Mirrors
// lib/validation/moderation.ts's convention exactly -- every search-param
// field parses independently and a bad value is silently dropped rather
// than failing the whole page, while the Server Action schema is strict
// and rejects outright.

export const APP_ROLES = ["user", "editor", "moderator", "admin"] as const;
export type AppRoleValue = (typeof APP_ROLES)[number];

const userAccountsFieldSchemas = {
  search: z.string().trim().min(1).max(200),
  role: z.enum(APP_ROLES),
  page: z.coerce.number().int().min(1),
};

export type UserAccountsSearchFilters = {
  search?: string;
  role?: AppRoleValue;
  page: number;
};

// Matches list_user_accounts()'s own default; the RPC independently clamps
// whatever it receives to [1,50], so this is a UI page size, never a trust
// boundary on its own.
export const USER_ACCOUNTS_PAGE_SIZE = 25;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Never throws -- same convention as parseModerationQueueSearchParams. */
export function parseUserAccountsSearchParams(
  searchParams: Record<string, string | string[] | undefined>,
): UserAccountsSearchFilters {
  const result: UserAccountsSearchFilters = { page: 1 };
  for (const key of Object.keys(
    userAccountsFieldSchemas,
  ) as (keyof typeof userAccountsFieldSchemas)[]) {
    const raw = firstValue(searchParams[key]);
    if (raw === undefined) continue;
    const parsed = userAccountsFieldSchemas[key].safeParse(raw);
    if (!parsed.success) continue;
    if (key === "page") {
      result.page = parsed.data as number;
    } else if (key === "role") {
      result.role = parsed.data as AppRoleValue;
    } else {
      result.search = parsed.data as string;
    }
  }
  return result;
}

/**
 * The only Server Action input in this phase. `userId` is validated as a
 * uuid here purely so a malformed value gets a friendly message instead of
 * a Postgres cast error -- it is never trusted as authorization
 * (Engineering Rule 2). admin_set_user_role() re-derives the caller's own
 * admin status from the database and applies both the self-demotion and
 * last-admin guards regardless of what this form sent.
 */
export const setUserRoleSchema = z.object({
  userId: z.uuid(),
  role: z.enum(APP_ROLES),
});

export type SetUserRoleInput = z.infer<typeof setUserRoleSchema>;
