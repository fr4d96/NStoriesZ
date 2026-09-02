import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/get-current-user";

// Every function here derives the caller from the session internally — none
// accept a userId parameter (the RPCs themselves also re-derive auth.uid()
// server-side; getCurrentUser() here is only so a signed-out caller gets a
// clean empty result instead of a raw Postgres auth error).

export async function listMyStories() {
  const user = await getCurrentUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_my_stories");
  if (error) throw error;
  return data ?? [];
}

export type MyStoryWithCover = Awaited<
  ReturnType<typeof listMyStories>
>[number] & {
  coverMediaId: string | null;
  coverAltText: string | null;
  /**
   * The status of the story's in-flight revision ("draft" or "submitted"),
   * or null when nothing is in flight. The story's own lifecycle_status is
   * not enough on a PUBLISHED story: an edit to a published story leaves
   * lifecycle_status = 'published' the whole way through review (that is
   * what keeps the old version live), so the draft pointer alone cannot say
   * whether the contributor may still edit it or is waiting on a moderator.
   */
  draftRevisionStatus: string | null;
};

/**
 * listMyStories() in the shape the grid/list view wants: the cover image
 * reference for its thumbnails, plus the in-flight draft's status for its
 * chips and Edit control.
 *
 * Both come straight off list_my_stories() -- `cover_media_id`/
 * `cover_alt_text` (20260831090000_list_my_stories_cover.sql) and
 * `draft_revision_status` (20260902090300_list_my_stories_draft_revision_status.sql).
 * This used to fan out to get_story_preview() once per story via Promise.all
 * to derive the same three values, which was an N+1 (30 drafts = 31 round
 * trips) and pulled an entire preview payload -- full content_json, every
 * attached media row -- per story to keep three scalars. One RPC now; the
 * per-story try/catch that used to swallow get_story_preview()'s "has no
 * revision to preview" RAISE went with it, since a story with no revision
 * simply yields nulls here.
 *
 * Still no storage path of any kind -- only a mediaId, from which a signed
 * URL is minted separately after an independent authorization re-check.
 */
export async function listMyStoriesWithCovers(): Promise<MyStoryWithCover[]> {
  const stories = await listMyStories();
  return stories.map((story) => ({
    ...story,
    coverMediaId: story.cover_media_id ?? null,
    coverAltText: story.cover_alt_text ?? null,
    draftRevisionStatus: story.draft_revision_status ?? null,
  }));
}

/**
 * Wrapped in React's cache() so the edit page's generateMetadata() and the
 * page component itself (both call this for the same storyId within one
 * request) share a single RPC round trip instead of duplicating it.
 */
export const getEditableStoryWithDraft = cache(async (storyId: string) => {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_my_story_with_draft", {
    p_story_id: storyId,
  });
  if (error) throw error;
  return data?.[0] ?? null;
});

export async function getCurrentConsentState(storyId: string) {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("current_consent_state", {
    p_story_id: storyId,
  });
  if (error) throw error;
  return data ?? null;
}

/**
 * The subset of a media row that PreviewGallery/PreviewContentBody actually
 * need to mint and render a preview -- structurally shared with
 * lib/story/moderation.ts's ModeratorMediaItem (a different RPC's row shape,
 * same presentation fields), so those two components work unchanged for a
 * moderator reviewing someone else's revision, not only for the owner's own
 * preview page.
 */
export type PreviewableMediaItem = {
  mediaId: string;
  sortOrder: number;
  isCover: boolean;
  altText: string | null;
  caption: string | null;
  decorative: boolean;
  processingState: string;
};

export type RevisionMediaItem = PreviewableMediaItem & {
  /** Hash of the processed derivative (Prompt 7) — used for same-story duplicate-image warnings, never a storage path. */
  sha256: string | null;
};

export type StoryPreview = {
  storyId: string;
  title: string;
  excerpt: string | null;
  contentJson: unknown;
  tripStartDate: string | null;
  tripEndDate: string | null;
  tripYear: number | null;
  travelStyle: string | null;
  totalExpenseNzdCents: number | null;
  sourceKind: string;
  lifecycleStatus: string;
  revisionId: string;
  revisionStatus: string;
  version: number;
  attributionType: string;
  attributionValue: string;
  viewerRelationship: string;
  media: RevisionMediaItem[];
};

/**
 * Wraps get_story_preview() — the only RPC allowed to back both the edit
 * page's attached-media list and the dedicated preview page (never the
 * public get_published_story family, which is wrong for unpublished
 * content; see docs/architecture.md "Private preview"). Returns no storage
 * path of any kind, only media_id + presentation fields — a signed URL for
 * each image is minted separately, only after independently re-checking
 * authorize_story_media_preview().
 */
export async function getStoryPreview(
  storyId: string,
): Promise<StoryPreview | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_story_preview", {
    p_story_id: storyId,
  });
  if (error) throw error;
  const row = data?.[0];
  if (!row) return null;
  return {
    storyId: row.story_id,
    title: row.title,
    excerpt: row.excerpt,
    contentJson: row.content_json,
    tripStartDate: row.trip_start_date,
    tripEndDate: row.trip_end_date,
    tripYear: row.trip_year,
    travelStyle: row.travel_style,
    totalExpenseNzdCents: row.total_expense_nzd_cents,
    sourceKind: row.source_kind,
    lifecycleStatus: row.lifecycle_status,
    revisionId: row.revision_id,
    revisionStatus: row.revision_status,
    version: row.version,
    attributionType: row.attribution_type,
    attributionValue: row.attribution_value,
    viewerRelationship: row.viewer_relationship,
    media: (row.media as unknown as RevisionMediaItem[] | null) ?? [],
  };
}

/**
 * One tag on a revision: either a reference to a `tags` lookup row (`id`
 * set) or a contributor-authored label (`id` null). `name` is what to show
 * either way -- resolved server-side so a retired (inactive) lookup tag,
 * which the edit form's own options list no longer contains, still renders
 * with its real name.
 */
export type RevisionTagSelection = {
  id: string | null;
  name: string;
};

export type RevisionSelections = {
  locations: Array<{
    regionId: string;
    destinationId: string | null;
    sortOrder: number;
  }>;
  tags: RevisionTagSelection[];
};

/**
 * Wraps get_revision_selections() (supabase/migrations/20260804091000_get_revision_selections.sql,
 * latest revision 20260816100200_get_revision_selections_tag_names.sql)
 * — the reader symmetric with set_revision_locations/set_revision_tags, so
 * the edit form doesn't forget the contributor's prior selections on reload.
 * The RPC still returns a `work_types` payload for already-recorded rows;
 * it is deliberately ignored here, since work types are retired from every
 * authoring surface (2026-08-16).
 */
export async function getRevisionSelections(
  revisionId: string,
): Promise<RevisionSelections> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_revision_selections", {
    p_revision_id: revisionId,
  });
  if (error) throw error;
  const row = data?.[0];
  const locations =
    (row?.locations as Array<{
      regionId: string;
      destinationId: string | null;
      sortOrder: number;
    }> | null) ?? [];
  const tags =
    (row?.tags as Array<{
      tagId: string | null;
      customLabel: string | null;
      name: string | null;
    }> | null) ?? [];
  return {
    locations,
    tags: tags
      .map((t) => ({
        id: t.tagId,
        name: t.name ?? t.customLabel ?? "",
      }))
      // A row with neither a resolvable name nor a label can't be shown or
      // meaningfully re-sent; dropping it is safer than rendering a blank
      // chip the contributor can't identify.
      .filter((t) => t.name.length > 0),
  };
}
