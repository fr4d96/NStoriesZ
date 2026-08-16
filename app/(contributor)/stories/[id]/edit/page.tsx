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
  listActiveTags,
} from "@/lib/story/active-lookups";
import { StoryEditForm } from "@/components/story/story-edit-form";
import { normalizeStoryContentJson } from "@/lib/story/legacy-content";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const draft = await getEditableStoryWithDraft(id);
  return {
    // revision_number === 1 means this story has never been through a
    // submit/changes-requested/resubmit cycle -- same signal the page
    // component uses below for its "New Story" vs "Edit Story" heading, so
    // the browser tab title always agrees with what's on the page.
    title: draft && draft.revision_number === 1 ? "New Story" : "Edit Story",
    robots: { index: false, follow: false },
  };
}

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
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
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

  const [selections, preview, regions, destinations, tags] = await Promise.all([
    getRevisionSelections(draft.revision_id),
    getStoryPreview(id),
    listActiveRegions(),
    listActiveDestinations(),
    listActiveTags(),
  ]);

  const parsedContent = normalizeStoryContentJson(draft.content_json);

  return (
    <StoryEditForm
      storyId={id}
      revisionId={draft.revision_id}
      initialVersion={draft.version}
      initialTitle={draft.title}
      initialExcerpt={draft.excerpt ?? ""}
      initialContentJson={parsedContent ?? []}
      initialTripStartDate={draft.trip_start_date}
      initialTripEndDate={draft.trip_end_date}
      initialTripYear={draft.trip_year}
      initialTravelStyle={draft.travel_style}
      initialTotalExpenseNzdCents={draft.total_expense_nzd_cents}
      initialContributorNote={draft.contributor_note ?? ""}
      initialLocations={selections.locations}
      initialTags={selections.tags}
      initialMedia={preview?.media ?? []}
      regions={regions}
      destinations={destinations}
      tags={tags}
      isNewStory={draft.revision_number === 1}
    />
  );
}
