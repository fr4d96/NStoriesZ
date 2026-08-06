import Link from "next/link";
import type {
  PublicRegion,
  PublicDestination,
} from "@/lib/story/public-queries";
import { regionNames } from "@/lib/story/card-fields";
import type { StoryCardData } from "@/components/story/story-card";
import { Reveal } from "@/components/home/reveal";
import { ArrowRightIcon } from "@/components/icons";

const TONE_CLASSES = {
  light: {
    card: "border-border-subtle bg-surface-muted hover:shadow-md",
    title: "text-foreground",
    meta: "text-foreground/60",
    link: "text-accent group-hover:underline",
  },
  onForest: {
    card: "border-white/15 bg-white/10 hover:bg-white/15",
    title: "text-white",
    meta: "text-white/65",
    link: "text-white group-hover:underline",
  },
} as const;

/**
 * Real regions/destinations only -- restricted to regions that actually
 * appear in the fetched story batch, so a tile never links to an empty
 * `/stories?region=` result. No stock photography (none of these regions
 * has licensed photography yet) and no fabricated story counts.
 */
export function RegionExplorer({
  regions,
  destinations,
  stories,
  tone = "light",
}: {
  regions: PublicRegion[];
  destinations: PublicDestination[];
  stories: StoryCardData[];
  /** "onForest" matches the mockup's always-dark .regions band (bg-forest section, regardless of light/dark theme). */
  tone?: "light" | "onForest";
}) {
  const presentNames = new Set(
    stories.flatMap((story) => regionNames(story.regions)),
  );
  const activeRegions = regions.filter((region) =>
    presentNames.has(region.name),
  );

  if (activeRegions.length === 0) return null;

  const t = TONE_CLASSES[tone];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {activeRegions.map((region, index) => {
        const regionDestinations = destinations
          .filter((destination) => destination.regionId === region.id)
          .map((destination) => destination.name);
        return (
          <Reveal key={region.id} delayMs={(index % 4) * 85}>
            <Link
              href={`/stories?region=${region.id}`}
              className={`group rounded-2xl border p-6 transition-[transform,box-shadow,background-color] hover:-translate-y-1 ${t.card}`}
            >
              <h3 className={`text-lg font-semibold tracking-tight ${t.title}`}>
                {region.name}
              </h3>
              {regionDestinations.length > 0 ? (
                <p className={`mt-1 text-sm ${t.meta}`}>
                  {regionDestinations.join(" · ")}
                </p>
              ) : null}
              <span
                className={`mt-3 inline-flex items-center gap-1 text-sm font-medium ${t.link}`}
              >
                Browse stories <ArrowRightIcon className="h-4 w-4" />
              </span>
            </Link>
          </Reveal>
        );
      })}
    </div>
  );
}
