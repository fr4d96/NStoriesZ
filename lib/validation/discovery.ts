import { z } from "zod";

// Public story-browse search-parameter validation. Every field parses
// independently and a bad value for one field is silently dropped rather
// than failing the whole page -- this is what makes a malformed/tampered
// query string safe (never a 500, never a partial page just because one
// param was garbage). Mirrors list_published_stories()'s own p_cost_band
// allow-list check (lib/story/public-queries.ts / the RPC itself) so an
// invalid cost band never reaches the database in the first place.

export const costBands = ["under_5k", "5k_15k", "15k_30k", "30k_plus"] as const;
export type CostBand = (typeof costBands)[number];

const fieldSchemas = {
  region: z.uuid(),
  destination: z.uuid(),
  tag: z.uuid(),
  tripYear: z.coerce.number().int().min(2000).max(2100),
  travelStyle: z.string().trim().min(1).max(100),
  costBand: z.enum(costBands),
  hasReportedExpense: z.enum(["true", "false"]).transform((v) => v === "true"),
  q: z.string().trim().min(1).max(200),
  cursorPublishedAt: z.iso.datetime(),
  cursorId: z.uuid(),
};

export type StorySearchFilters = {
  region?: string;
  destination?: string;
  tag?: string;
  tripYear?: number;
  travelStyle?: string;
  costBand?: CostBand;
  hasReportedExpense?: boolean;
  q?: string;
  cursorPublishedAt?: string;
  cursorId?: string;
};

type FieldKey = keyof typeof fieldSchemas;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Never throws -- see module doc comment above. */
export function parseStorySearchParams(
  searchParams: Record<string, string | string[] | undefined>,
): StorySearchFilters {
  const result: StorySearchFilters = {};
  for (const key of Object.keys(fieldSchemas) as FieldKey[]) {
    const raw = firstValue(searchParams[key]);
    if (raw === undefined) continue;
    const parsed = fieldSchemas[key].safeParse(raw);
    if (!parsed.success) continue;
    switch (key) {
      case "hasReportedExpense":
        result.hasReportedExpense = parsed.data as boolean;
        break;
      case "tripYear":
        result.tripYear = parsed.data as number;
        break;
      case "costBand":
        result.costBand = parsed.data as CostBand;
        break;
      default:
        (result as Record<string, string>)[key] = parsed.data as string;
    }
  }
  return result;
}

// Filter/sort/search params that must clear pagination when changed --
// used by the client filter bar to know which URLSearchParams keys to drop
// alongside cursorPublishedAt/cursorId whenever any of these change.
export const FILTER_PARAM_KEYS = [
  "region",
  "destination",
  "tag",
  "tripYear",
  "travelStyle",
  "costBand",
  "hasReportedExpense",
  "q",
] as const;

export const CURSOR_PARAM_KEYS = ["cursorPublishedAt", "cursorId"] as const;
