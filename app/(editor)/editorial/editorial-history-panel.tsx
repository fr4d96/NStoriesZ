import type { EditorialHistoryRow } from "@/lib/story/moderation";

/**
 * Read-only editorial-prep history (getStoryEditorialHistory()) -- kept
 * visibly separate from EditorialControls' log-evidence-note form above it
 * and from any moderation-decision UI, per Engineering Rule 5 ("editorial
 * preparation is a distinct workflow from moderation, different tables/
 * state where practical"): this panel only ever reads editorial_actions,
 * never moderation_actions.
 */
export function EditorialHistoryPanel({
  history,
}: {
  history: EditorialHistoryRow[];
}) {
  return (
    <section className="rounded-md border border-border-subtle p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Editorial history
      </h2>
      {history.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          No editorial preparation history yet.
        </p>
      ) : (
        <ul className="mt-3 space-y-2 text-sm">
          {history.map((h) => (
            <li key={h.id} className="border-b border-border-subtle pb-2">
              <span className="font-medium">{h.action_type}</span>{" "}
              <span className="text-muted-foreground">
                {new Date(h.created_at).toLocaleString("en-NZ")}
              </span>
              <p className="mt-1 text-muted-foreground">{h.summary}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
