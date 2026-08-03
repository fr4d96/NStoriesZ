import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getEditableStoryWithDraft,
  getStoryPreview,
  getRevisionSelections,
} from "@/lib/story/contributor-queries";
import {
  listActiveRegions,
  listActiveDestinations,
  listActiveWorkTypes,
  listActiveTags,
} from "@/lib/story/active-lookups";
import { StoryEditForm } from "@/components/story/story-edit-form";
import { storyContentSchema } from "@/lib/validation/story";

export const metadata: Metadata = {
  title: "Edit Story",
  robots: { index: false, follow: false },
};

export default async function EditStoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const draft = await getEditableStoryWithDraft(id);
  if (!draft) notFound();

  if (draft.revision_status !== "draft") {
    return (
      <div className="mx-auto max-w-xl px-4 py-12 sm:px-6 sm:py-16">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Not editable right now
        </h1>
        <p className="mt-2 text-black/70 dark:text-white/70">
          This story&apos;s current revision is{" "}
          {draft.revision_status.replace(/_/g, " ")} and can&apos;t be edited
          from this page.
        </p>
        <Link
          href={`/stories/${id}/preview`}
          className="mt-4 inline-block underline underline-offset-2"
        >
          View preview
        </Link>
      </div>
    );
  }

  const [selections, preview, regions, destinations, workTypes, tags] =
    await Promise.all([
      getRevisionSelections(draft.revision_id),
      getStoryPreview(id),
      listActiveRegions(),
      listActiveDestinations(),
      listActiveWorkTypes(),
      listActiveTags(),
    ]);

  const parsedContent = storyContentSchema.safeParse(draft.content_json);

  return (
    <StoryEditForm
      storyId={id}
      revisionId={draft.revision_id}
      initialVersion={draft.version}
      initialTitle={draft.title}
      initialExcerpt={draft.excerpt ?? ""}
      initialContentJson={parsedContent.success ? parsedContent.data : []}
      initialTripStartDate={draft.trip_start_date}
      initialTripEndDate={draft.trip_end_date}
      initialTripYear={draft.trip_year}
      initialTravelStyle={draft.travel_style}
      initialTotalExpenseNzdCents={draft.total_expense_nzd_cents}
      initialContributorNote={draft.contributor_note ?? ""}
      initialLocations={selections.locations}
      initialWorkTypeIds={selections.workTypeIds}
      initialTagIds={selections.tagIds}
      initialMedia={preview?.media ?? []}
      regions={regions}
      destinations={destinations}
      workTypes={workTypes}
      tags={tags}
    />
  );
}
