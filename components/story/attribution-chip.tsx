import Link from "next/link";
import { MapPinIcon, TripYearIcon } from "@/components/icons";

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
        {destination || tripYear ? (
          <span className="flex items-center gap-2.5 text-xs text-foreground/60">
            {destination ? (
              <span className="inline-flex items-center gap-1">
                <MapPinIcon className="h-3.5 w-3.5 shrink-0" />
                {destination}
              </span>
            ) : null}
            {tripYear ? (
              <span className="inline-flex items-center gap-1">
                <TripYearIcon className="h-3.5 w-3.5 shrink-0" />
                {tripYear}
              </span>
            ) : null}
          </span>
        ) : null}
      </span>
    </div>
  );
}
