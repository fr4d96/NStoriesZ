import type { Metadata } from "next";
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
import { getStoryEditorialHistory } from "@/lib/story/moderation";
import { EditorialControls } from "../editorial-controls";
import { EditorialHistoryPanel } from "../../editorial-history-panel";

export const metadata: Metadata = {
  title: "Edit Editorial Import",
  robots: { index: false, follow: false },
};

export default async function EditorialEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // get_my_story_with_draft() authorizes the assigned editor as of Prompt 4
  // Sub-phase 4 (previously owner/linked-contributor only -- a real gap,
  // see docs/implementation-status.md).
  const draft = await getEditableStoryWithDraft(id);
  if (!draft) notFound();
  if (draft.source_kind !== "editorial_import") notFound();

  if (draft.lifecycle_status === "awaiting_contributor_approval") {
    const editorialHistory = await getStoryEditorialHistory(id);
    return (
      <div className="mx-auto max-w-xl px-4 py-12 sm:px-6 sm:py-16">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Awaiting contributor review
        </h1>
        <p className="mt-2 text-black/70 dark:text-white/70">
          This draft has been sent to the linked contributor for review and is
          frozen until they approve, request changes, or decline it.
        </p>
        <EditorialControls
          storyId={id}
          revisionId={draft.revision_id}
          version={draft.version}
          lifecycleStatus={draft.lifecycle_status}
          showMarkReady={false}
        />
        <div className="mt-8">
          <EditorialHistoryPanel history={editorialHistory} />
        </div>
      </div>
    );
  }

  if (draft.revision_status !== "draft") {
    const editorialHistory = await getStoryEditorialHistory(id);
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
        <div className="mt-8">
          <EditorialHistoryPanel history={editorialHistory} />
        </div>
      </div>
    );
  }

  const [
    selections,
    preview,
    regions,
    destinations,
    workTypes,
    tags,
    editorialHistory,
  ] = await Promise.all([
    getRevisionSelections(draft.revision_id),
    getStoryPreview(id),
    listActiveRegions(),
    listActiveDestinations(),
    listActiveWorkTypes(),
    listActiveTags(),
    getStoryEditorialHistory(id),
  ]);

  const parsedContent = storyContentSchema.safeParse(draft.content_json);

  return (
    <div>
      <EditorialControls
        storyId={id}
        revisionId={draft.revision_id}
        version={draft.version}
        lifecycleStatus={draft.lifecycle_status}
        showMarkReady
      />
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
        showContentImport
      />
      <div className="mx-auto max-w-3xl px-4 pb-12 sm:px-6">
        <EditorialHistoryPanel history={editorialHistory} />
      </div>
    </div>
  );
}
