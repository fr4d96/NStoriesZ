"use server";

import { createReportSchema } from "@/lib/validation/story";
import { createStoryReport } from "@/lib/story/mutations";

export type ReportActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "needs-sign-in" }
  | { status: "error"; message: string }
  | { status: "validation-error"; fieldErrors: Record<string, string[]> };

/**
 * The one place this route's report flow ever checks auth state --
 * deliberately not the page itself (app/(public)/stories/[id]/page.tsx
 * stays a static Server Component that never calls getCurrentUser(), so it
 * keeps the caching behavior every other public page relies on). A
 * signed-out submission surfaces as a plain "you must be signed in" error
 * from createStoryReport() (lib/story/mutations.ts#requireUser); this is
 * the only place that translates it into a UI state.
 *
 * A duplicate open report (story_reports_reporter_story_open_unique_idx,
 * Postgres 23505) and a genuine success both resolve to the exact same
 * neutral confirmation -- never revealing whether the caller already has an
 * open report on this story (private reporter identity/state, per
 * docs/content-governance.md "Reporting").
 */
export async function reportStoryAction(
  _prevState: ReportActionState,
  formData: FormData,
): Promise<ReportActionState> {
  const parsed = createReportSchema.safeParse({
    storyId: formData.get("storyId"),
    category: formData.get("category"),
    details: formData.get("details") ?? "",
  });

  if (!parsed.success) {
    return {
      status: "validation-error",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    await createStoryReport(
      parsed.data.storyId,
      parsed.data.category,
      parsed.data.details || undefined,
    );
    return { status: "success" };
  } catch (err) {
    if (err instanceof Error && err.message === "You must be signed in.") {
      return { status: "needs-sign-in" };
    }
    const code = (err as { code?: string } | null)?.code;
    if (code === "23505") {
      // Already has an open report on this story -- neutral, same as success.
      return { status: "success" };
    }
    return {
      status: "error",
      message: "Something went wrong. Please try again.",
    };
  }
}
