/**
 * Product spec / Engineering Rule 17: every public story must visibly carry
 * a "personal experience, not advice" label -- a real, consistently-placed
 * component, not a footnote. Used on both the story detail page and the
 * home page (docs/design-brief.md).
 */
export function PersonalExperienceLabel() {
  return (
    <p className="inline-flex items-center gap-2 rounded-full border border-border-subtle bg-surface-muted px-3 py-1 text-xs font-medium text-tag-foreground">
      <span aria-hidden="true">●</span>
      One person&apos;s experience — not immigration, legal, employment, tax, or
      financial advice
    </p>
  );
}
