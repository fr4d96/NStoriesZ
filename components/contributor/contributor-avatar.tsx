/**
 * A contributor's public avatar: their chosen emoji, or the first letter of
 * their display name as a fallback.
 *
 * Server component — no interactivity, so no "use client". aria-hidden on
 * the whole thing is deliberate in both branches: the emoji carries no
 * information a reader needs, and the initial letter is a fragment of the
 * display name that is already announced by the heading beside it. Reading
 * out "K" before "Kai Lin" is noise, not accessibility (Engineering Rule
 * 19).
 */
/**
 * The letter shown when there is no emoji. `Array.from` rather than
 * `charAt(0)`: charAt indexes UTF-16 code units, so a display name starting
 * with an astral-plane character (an emoji, or one of the rarer CJK
 * extension characters) returned half a surrogate pair and rendered as the
 * replacement glyph. Taking the first code point costs nothing and is
 * correct for the non-Latin names this product should expect -- CLAUDE.md's
 * "nationality is data, not a hard-coded string" applies to names too.
 *
 * "?" only for a name that is empty or whitespace-only. contributors
 * .display_name is CHECKed to 1-120 characters, so that should be
 * unreachable from a contributor row; it is here because story surfaces
 * feed this from an attribution value with its own fallbacks.
 */
function initial(displayName: string): string {
  return Array.from(displayName.trim())[0]?.toUpperCase() ?? "?";
}

export function ContributorAvatar({
  emoji,
  displayName,
  className = "h-10 w-10 text-lg",
}: {
  emoji: string | null;
  displayName: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full bg-surface-muted font-semibold text-foreground/70 ${className}`}
    >
      {emoji || initial(displayName)}
    </span>
  );
}
