import "server-only";
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

export async function getEditableStoryWithDraft(storyId: string) {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_my_story_with_draft", {
    p_story_id: storyId,
  });
  if (error) throw error;
  return data?.[0] ?? null;
}

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

export type RevisionMediaItem = {
  mediaId: string;
  sortOrder: number;
  isCover: boolean;
  altText: string | null;
  caption: string | null;
  decorative: boolean;
  processingState: string;
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

export type RevisionSelections = {
  locations: Array<{
    regionId: string;
    destinationId: string | null;
    sortOrder: number;
  }>;
  workTypeIds: string[];
  tagIds: string[];
};

/**
 * Wraps get_revision_selections() (supabase/migrations/20260804091000_get_revision_selections.sql)
 * — the missing reader symmetric with set_revision_locations/
 * set_revision_work_types/set_revision_tags, added in this sub-phase so the
 * edit form doesn't forget the contributor's prior selections on reload.
 * NOT applied to the linked hosted project yet — see that migration's
 * header comment and this sub-phase's implementation-status entry.
 *
 * The generated Database type doesn't know this RPC yet (types/database.ts
 * is generated, never hand-edited — Prompt 4's own convention); the return
 * shape is asserted manually here instead of widening the generated type.
 */
export async function getRevisionSelections(
  revisionId: string,
): Promise<RevisionSelections> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "get_revision_selections" as never,
    { p_revision_id: revisionId } as never,
  );
  if (error) throw error;
  const row = (
    data as unknown as
      | {
          locations: Array<{
            regionId: string;
            destinationId: string | null;
            sortOrder: number;
          }>;
          work_type_ids: string[];
          tag_ids: string[];
        }[]
      | null
  )?.[0];
  return {
    locations: row?.locations ?? [],
    workTypeIds: row?.work_type_ids ?? [],
    tagIds: row?.tag_ids ?? [],
  };
}
