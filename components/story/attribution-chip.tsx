import Link from "next/link";

export function AttributionChip({
  name,
  contributorSlug,
  tripYear,
  destination,
}: {
  name: string;
  contributorSlug?: string | null;
  tripYear?: number | null;
  destination?: string | null;
}) {
  const meta = [destination, tripYear ? String(tripYear) : null]
    .filter(Boolean)
    .join(" · ");

  const nameNode = contributorSlug ? (
    <Link
      href={`/contributors/${contributorSlug}`}
      className="font-medium hover:underline"
    >
      {name}
    </Link>
  ) : (
    <span className="font-medium">{name}</span>
  );

  return (
    <div className="flex items-center gap-2 text-sm">
      <span
        aria-hidden="true"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs font-semibold text-foreground/70"
      >
        {name.trim().charAt(0).toUpperCase() || "?"}
      </span>
      <span>
        {nameNode}
        {meta ? (
          <span className="block text-xs text-foreground/60">{meta}</span>
        ) : null}
      </span>
    </div>
  );
}
