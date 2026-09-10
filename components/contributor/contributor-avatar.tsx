/**
 * The initial-letter circle that stands in for a contributor's face.
 *
 * This existed three times, copy-pasted, before it existed once: on the
 * story card's AttributionChip, on the /contributors directory card, and
 * on the /contributors/[slug] profile header. All three built the same
 * letter from the same expression and painted it with the same classes,
 * which meant three places to fix whenever the treatment changed -- and
 * they had already drifted apart in two small ways (see `aria-hidden` and
 * `shrink-0` below). Anything that gives a contributor a real avatar later
 * should change this file and nothing else.
 *
 * `aria-hidden` is unconditional and not a prop. The letter carries no
 * information: it is derived from the display name, and every call site
 * renders that same display name as text immediately beside it. Announcing
 * "K" before "Kai Rahman" is pure noise, so this stays decorative. The
 * directory card was the one surface that had omitted it, which is the
 * drift this consolidation settles -- in the direction of the two that
 * were right.
 *
 * `shrink-0` is likewise unconditional. Only the AttributionChip had it,
 * but every call site puts this in a flex row or column beside text that
 * can be long, and a squashed ellipse is never the intended result.
 */

/**
 * The three sizes the existing call sites established, kept exactly as they
 * were so this refactor changes no pixels: `sm` for the story card's
 * attribution chip, `md` for a directory card, `lg` for a profile header.
 * Deliberately a fixed set rather than a free `className` for height/text
 * -- three surfaces sharing three sizes is the whole point, and an open
 * prop would let them drift again.
 */
const sizeClasses = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-16 w-16 text-2xl",
} as const;

export type ContributorAvatarSize = keyof typeof sizeClasses;

/**
 * The displayed letter. `Array.from` rather than `charAt(0)`, which every
 * one of the three originals used: `charAt` indexes UTF-16 code units, so a
 * display name starting with an astral-plane character (an emoji, or one of
 * the rarer CJK extension characters) returned half a surrogate pair and
 * rendered as the replacement glyph. Taking the first code point instead
 * costs nothing and is correct for the non-Latin names this product should
 * expect -- see CLAUDE.md on nationality being data, not an assumption.
 *
 * Falls back to "?" for a name that is empty or whitespace-only. The DB
 * constrains display_name to 1-120 characters
 * (supabase/migrations/20260802085016_contributors.sql), so this should be
 * unreachable through a contributor row; it is here because the prop is
 * also fed from story attribution values, which resolve through their own
 * fallbacks.
 */
function initial(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "?";
}

export function ContributorAvatar({
  name,
  size = "md",
  className = "",
}: {
  name: string;
  size?: ContributorAvatarSize;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full bg-surface-muted font-semibold text-foreground/70 ${sizeClasses[size]} ${className}`}
    >
      {initial(name)}
    </span>
  );
}
