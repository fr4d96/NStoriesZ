import type { CountedSlice } from "@/lib/story/moderation-analytics";
import type { AppRoleValue } from "@/lib/validation/admin";

/**
 * Pure derivations behind the /admin overview.
 *
 * Deliberately I/O-free and free of `server-only`, exactly like
 * lib/story/moderation-analytics.ts: every figure on the admin dashboard is
 * computed here from rows that RPCs which ALREADY EXIST and are ALREADY
 * admin-readable return -- get_operational_metrics() (editor/moderator/
 * admin) and list_user_accounts() (admin only, added in Phase 1). Phase 2
 * adds no migration, no new grant, and nothing an admin could not already
 * read through /moderation, /readiness or /admin/users.
 *
 * The page is the only caller; these functions are what the unit tests
 * exercise.
 */

/**
 * Structural mirror of get_operational_metrics()'s single row. Declared
 * here rather than imported from lib/story/readiness.ts so this module
 * stays free of anything that pulls in `server-only`, and so the tests can
 * build one by hand.
 */
export type OperationalMetricsLike = {
  draft_imports_count: number;
  awaiting_contributor_approval_count: number;
  awaiting_moderation_count: number;
  published_count: number;
  missing_consent_count: number;
  images_missing_alt_text_count: number;
  open_reports_count: number;
};

/**
 * A slice of a part-to-whole bar: CountedSlice plus the presentation bits
 * AgeStackedBar needs (a short axis-scale label and a 1-4 severity step
 * that picks a --chart-N token).
 */
export type StackedSlice = CountedSlice & {
  shortLabel: string;
  step: 1 | 2 | 3 | 4;
};

const PIPELINE_STAGES: {
  key: keyof OperationalMetricsLike;
  label: string;
  shortLabel: string;
  step: 1 | 2 | 3 | 4;
}[] = [
  {
    key: "draft_imports_count",
    label: "Editorial imports in draft",
    shortLabel: "Import draft",
    step: 1,
  },
  {
    key: "awaiting_contributor_approval_count",
    label: "Awaiting contributor approval",
    shortLabel: "Contributor",
    step: 2,
  },
  {
    key: "awaiting_moderation_count",
    label: "Awaiting moderation",
    shortLabel: "Moderation",
    step: 3,
  },
];

/**
 * The unpublished catalogue, in the order a story actually moves through
 * it. Published is deliberately NOT a stage here: it is an order of
 * magnitude larger than the in-flight stages, so including it in the same
 * stacked bar would compress every stage that an admin can still act on
 * into an invisible sliver. It is a stat tile instead.
 *
 * Honest limit, disclosed in the UI rather than hidden: `draft_imports_count`
 * counts editorial imports only (`source_kind = 'editorial_import'`), so a
 * self-submitted draft that has never been submitted appears in no stage.
 * get_operational_metrics() has no count for those and Phase 2 adds no
 * database surface, so the panel says so rather than implying the bar is
 * every unpublished story.
 */
export function buildPipelineStages(
  metrics: OperationalMetricsLike | null,
): StackedSlice[] {
  return PIPELINE_STAGES.map((stage) => ({
    key: stage.key,
    label: stage.label,
    shortLabel: stage.shortLabel,
    step: stage.step,
    count: metrics ? metrics[stage.key] : 0,
  }));
}

/**
 * The three things get_operational_metrics() reports that BLOCK or
 * jeopardise publication, as opposed to merely describing volume. Zero
 * counts are kept rather than filtered out: "0 stories missing consent" is
 * the reassuring reading of this panel, and dropping the row would make an
 * all-clear look like a rendering failure.
 */
export function buildPublicationBlockers(
  metrics: OperationalMetricsLike | null,
): CountedSlice[] {
  return [
    {
      key: "missing_consent",
      label: "Stories with no consent record",
      count: metrics?.missing_consent_count ?? 0,
    },
    {
      key: "images_missing_alt_text",
      label: "Images missing alt text",
      count: metrics?.images_missing_alt_text_count ?? 0,
    },
    {
      key: "open_reports",
      label: "Open or reviewing reader reports",
      count: metrics?.open_reports_count ?? 0,
    },
  ];
}

export const ROLE_LABELS: Record<AppRoleValue, string> = {
  user: "Contributor",
  editor: "Editor",
  moderator: "Moderator",
  admin: "Admin",
};

/** Most-privileged first -- this list is read as "who can do what". */
export const ROLE_DISPLAY_ORDER: readonly AppRoleValue[] = [
  "admin",
  "moderator",
  "editor",
  "user",
] as const;

export type RoleCounts = Record<AppRoleValue, number>;

export function emptyRoleCounts(): RoleCounts {
  return { user: 0, editor: 0, moderator: 0, admin: 0 };
}

/**
 * Role mix, plus an explicit "no role row" slice.
 *
 * `total` is the unfiltered account count, which is NOT the sum of the four
 * role counts: list_user_accounts() LEFT JOINs user_roles, so an account
 * that has never been given a role at all is counted in the total and in
 * none of the filters. Surfacing that difference as its own labelled slice
 * is the point -- it is the population an admin would otherwise never see,
 * and silently folding it into "Contributor" would misstate who actually
 * holds a role. Clamped at zero so a torn read (four filtered counts and
 * the total are five separate queries) can never render a negative bar.
 */
export function summarizeRoleDistribution(
  counts: RoleCounts,
  total: number,
): CountedSlice[] {
  const assigned = ROLE_DISPLAY_ORDER.reduce(
    (sum, role) => sum + counts[role],
    0,
  );
  const slices: CountedSlice[] = ROLE_DISPLAY_ORDER.map((role) => ({
    key: role,
    label: ROLE_LABELS[role],
    count: counts[role],
  }));
  slices.push({
    key: "unassigned",
    label: "No role assigned",
    count: Math.max(total - assigned, 0),
  });
  return slices;
}

/** Everyone who can reach a staff surface at all. */
export function countStaff(counts: RoleCounts): number {
  return counts.admin + counts.moderator + counts.editor;
}

/**
 * Guard mirrored from lib/admin/role-changes.ts and, underneath it,
 * admin_set_user_role()'s SQLSTATE WHV02 branch. Shown on the dashboard as
 * a warning, never as an action: the enforcement lives in the database.
 */
export function isLastAdminStanding(counts: RoleCounts): boolean {
  return counts.admin <= 1;
}

/** Display name for an account row, without ever falling back to its email. */
export function accountLabel(account: {
  display_name: string | null;
  user_id: string;
}): string {
  const name = account.display_name?.trim();
  if (name) return name;
  // The short id is enough to tell two unnamed accounts apart and to
  // recognise the row again on its detail page. Email is deliberately not
  // used here: /admin/users and its detail page are where an admin goes to
  // read an address, and an overview does not need one to be useful.
  return `Unnamed account ${account.user_id.slice(0, 8)}`;
}
