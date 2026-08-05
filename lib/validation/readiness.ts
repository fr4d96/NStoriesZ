import { z } from "zod";

// Content-readiness dashboard search-parameter validation. Same "every
// field parses independently, a bad value is silently dropped rather than
// failing the whole page" convention as lib/validation/moderation.ts /
// lib/validation/discovery.ts.

const readinessQueueFieldSchemas = {
  sourceKind: z.enum(["self_submitted", "editorial_import"]),
  lifecycleStatus: z.enum([
    "draft",
    "awaiting_contributor_approval",
    "pending_review",
    "changes_requested",
    "published",
    "rejected",
    "archived",
  ]),
  page: z.coerce.number().int().min(1),
};

export type ReadinessQueueSearchFilters = {
  sourceKind?: string;
  lifecycleStatus?: string;
  page: number;
};

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export const READINESS_QUEUE_PAGE_SIZE = 20;

/** Never throws -- see module doc comment above. */
export function parseReadinessQueueSearchParams(
  searchParams: Record<string, string | string[] | undefined>,
): ReadinessQueueSearchFilters {
  const result: ReadinessQueueSearchFilters = { page: 1 };
  for (const key of Object.keys(
    readinessQueueFieldSchemas,
  ) as (keyof typeof readinessQueueFieldSchemas)[]) {
    const raw = firstValue(searchParams[key]);
    if (raw === undefined) continue;
    const parsed = readinessQueueFieldSchemas[key].safeParse(raw);
    if (!parsed.success) continue;
    if (key === "page") {
      result.page = parsed.data as number;
    } else if (key === "sourceKind") {
      result.sourceKind = parsed.data as string;
    } else if (key === "lifecycleStatus") {
      result.lifecycleStatus = parsed.data as string;
    }
  }
  return result;
}

export const recordLaunchVerificationSchema = z
  .object({
    storyId: z.uuid(),
    desktopChecked: z.boolean(),
    mobileChecked: z.boolean(),
    note: z.string().trim().max(2000).optional().or(z.literal("")),
  })
  .refine((data) => data.desktopChecked || data.mobileChecked, {
    message: "Check at least one of desktop or mobile.",
    path: ["desktopChecked"],
  });

export type RecordLaunchVerificationInput = z.infer<
  typeof recordLaunchVerificationSchema
>;
