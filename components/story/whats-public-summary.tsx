const ATTRIBUTION_LABELS: Record<string, string> = {
  real_name: "your real name",
  display_name: "your chosen display name",
  pseudonym: "a pseudonym",
  anonymous: "anonymous (no name shown)",
};

export type WhatsPublicSummaryProps = {
  attributionType: string;
  attributionValue: string;
  hasExcerpt: boolean;
  imageCount: number;
  decorativeImageCount: number;
};

/**
 * Prompt 7: "Show exactly which fields are public" -- a plain-language
 * summary of what a reader will actually see if this story is approved,
 * shown alongside the contributor's own approve/submit action. Never
 * includes internal editorial or moderation notes (editor_note,
 * moderation_action_notes, story_publication_consent_notes) -- those are
 * staff-only, structurally separate tables this component's caller never
 * even queries (see get_story_preview()), not merely hidden here.
 */
export function WhatsPublicSummary({
  attributionType,
  attributionValue,
  hasExcerpt,
  imageCount,
  decorativeImageCount,
}: WhatsPublicSummaryProps) {
  const attributionLabel =
    ATTRIBUTION_LABELS[attributionType] ?? attributionType;
  const captionedImageCount = imageCount - decorativeImageCount;

  return (
    <div className="rounded-md border border-black/10 p-4 text-sm dark:border-white/10">
      <h2 className="text-sm font-semibold">What will be public</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-black/70 dark:text-white/70">
        <li>
          Your name will show as: <strong>{attributionValue}</strong> (
          {attributionLabel})
        </li>
        <li>
          The full story title{hasExcerpt ? " and excerpt" : ""} and body text
        </li>
        <li>
          Trip details you set: region, destination, work type, tags, trip
          date/year, travel style, and reported cost (if you added one)
        </li>
        {imageCount > 0 && (
          <li>
            {imageCount} image{imageCount === 1 ? "" : "s"}
            {captionedImageCount > 0
              ? ` (${captionedImageCount} with a visible caption)`
              : ""}
            , with alt text and metadata already stripped
          </li>
        )}
      </ul>
      <p className="mt-2 text-xs text-black/60 dark:text-white/60">
        Internal editor and moderator notes are never shown publicly. You can
        request removal or correction at any time — see{" "}
        <a href="/copyright" className="underline underline-offset-2">
          Copyright &amp; Removal
        </a>
        .
      </p>
    </div>
  );
}
