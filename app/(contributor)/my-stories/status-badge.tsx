const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  awaiting_contributor_approval: "Awaiting your approval",
  pending_review: "In review",
  changes_requested: "Changes requested",
  published: "Published",
  rejected: "Not approved",
  archived: "Archived",
};

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-black/10 text-black/70 dark:bg-white/10 dark:text-white/70",
  awaiting_contributor_approval:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  pending_review:
    "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  changes_requested:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  published:
    "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  rejected: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  archived: "bg-black/10 text-black/50 dark:bg-white/10 dark:text-white/50",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
        STATUS_STYLES[status] ?? STATUS_STYLES.draft
      }`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
