const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  // The contributor finished this one and chose to keep it to themselves.
  // "Private", not "Saved" or "Unpublished": it says who can see it, which
  // is the only thing they actually chose.
  private: "Private",
  awaiting_contributor_approval: "Awaiting your approval",
  pending_review: "In review",
  changes_requested: "Changes requested",
  published: "Published",
  rejected: "Not approved",
  archived: "Archived",
};

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-surface-muted text-foreground/65",
  // Same quiet treatment as Draft rather than a warning colour -- keeping a
  // story private is a normal, finished outcome, not a problem state.
  private: "bg-surface-muted text-foreground/65",
  awaiting_contributor_approval: "bg-accent/15 text-accent",
  pending_review: "bg-tag-background text-tag-foreground",
  changes_requested: "bg-accent/15 text-accent",
  published: "bg-fern/15 text-fern",
  rejected: "bg-destructive/12 text-destructive",
  archived: "bg-surface-muted text-foreground/45",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${
        STATUS_STYLES[status] ?? STATUS_STYLES.draft
      }`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
