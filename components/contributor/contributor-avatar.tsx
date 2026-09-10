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
      {emoji || displayName.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}
