import Link from "next/link";
import { ContributorAvatar } from "@/components/contributor/contributor-avatar";
import { MapPinIcon, TripYearIcon } from "@/components/icons";

/**
 * `avatarEmoji` comes from list_published_stories()/get_published_story()'s
 * contributor_avatar_emoji (20260910120000), which is already null for a
 * non-public contributor AND for any story published anonymously -- the
 * emoji is gated on the per-story consent, not the contributor's default,
 * so the same avatar can never appear beside the word "Anonymous" and link
 * someone's anonymous stories together. Nothing here re-derives that; this
 * renders what the reader returned, and ContributorAvatar falls back to the
 * initial letter on null.
 */
export function AttributionChip({
  name,
  contributorSlug,
  avatarEmoji = null,
  tripYear,
  destination,
}: {
  name: string;
  contributorSlug?: string | null;
  avatarEmoji?: string | null;
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
      <ContributorAvatar
        emoji={avatarEmoji}
        displayName={name}
        className="h-8 w-8 text-xs"
      />
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
