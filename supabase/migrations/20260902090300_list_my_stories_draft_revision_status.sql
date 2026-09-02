-- Finishes what 20260831090000_list_my_stories_cover.sql started: removing the
-- per-story get_story_preview() fan-out behind My Stories.
--
-- THE PROBLEM
--
-- 20260831090000 added cover_media_id/cover_alt_text so
-- lib/story/contributor-queries.ts's listMyStoriesWithCovers() would no longer
-- need one get_story_preview() call per story (30 drafts = 31 round trips,
-- each building an ENTIRE preview payload -- full content_json plus a
-- jsonb_agg of every attached media row -- to keep two scalars). The
-- TypeScript was never switched over, and in the meantime that same fan-out
-- picked up a SECOND consumer: `draftRevisionStatus`, added 2026-09-02 for
-- the "edit a published story" flow.
--
-- My Stories has to tell an in-flight draft the contributor may still edit
-- apart from one already submitted and waiting on a moderator. On a FIRST
-- submission that is visible in the story's own lifecycle_status
-- (draft vs pending_review), which list_my_stories() already returns. On an
-- ALREADY-PUBLISHED story it is not: submitting an edit deliberately leaves
-- lifecycle_status = 'published' from submit right through approval -- that
-- is exactly what keeps the live version live (Engineering Rule 11) -- so
-- both states look identical from here: 'published' plus a non-null
-- current_draft_revision_id. Only the draft revision's own revision_status
-- separates them.
--
-- WHAT THIS CHANGES
--
-- One trailing OUT column, `draft_revision_status`. Every existing OUT
-- column, `regions` and the two cover columns included, is preserved
-- unchanged, as are the WHERE clause, the ordering, the grants and the
-- security definer settings.
--
-- WHICH REVISION IT DESCRIBES. Note the join: `dr` is
-- s.current_draft_revision_id directly, NOT the coalesced
-- current-draft-or-published `r` that title/excerpt/regions/cover read. That
-- distinction is the whole point of the column -- coalescing would report the
-- PUBLISHED revision's status ('approved') for a story with nothing in
-- flight, which says nothing about work in flight and is exactly the
-- ambiguity this column exists to remove. A story with no current draft
-- yields NULL, matching what the TypeScript computed before.
--
-- This returns the identical value listMyStoriesWithCovers() derives today:
-- it called get_story_preview(), which resolves
-- coalesce(current_draft_revision_id, published_revision_id), and then kept
-- that revision_status ONLY when the returned revision_id matched
-- current_draft_revision_id -- null otherwise. Same row, one join instead of
-- N round trips.
--
-- SECURITY (Engineering Rules 2, 13, 14) -- unchanged from 20260831090000:
-- this function still returns NO storage path of any kind, only
-- cover_media_id + cover_alt_text, and the signed URL for a cover is minted
-- separately after an independent authorization re-check. revision_status is
-- not new information to this caller either: it is the status of the
-- caller's OWN draft on a story they already read title, excerpt and cover
-- from, and the same value get_story_preview() already hands them.
--
-- Return row shape changes (one new OUT column), so DROP first -- same as the
-- 20260831090000 cover change, the 20260829090000 regions change and the
-- 20260812100000 title/excerpt change.
drop function if exists public.list_my_stories();

create function public.list_my_stories()
returns table (
  id uuid, slug text, source_kind public.story_source_kind, visibility public.story_visibility,
  lifecycle_status public.story_lifecycle_status, current_draft_revision_id uuid,
  published_revision_id uuid, version integer, submitted_at timestamptz, published_at timestamptz,
  archived_at timestamptz, created_at timestamptz, updated_at timestamptz,
  title text, excerpt text, regions jsonb,
  cover_media_id uuid, cover_alt_text text,
  draft_revision_status public.story_revision_status
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.slug, s.source_kind, s.visibility, s.lifecycle_status, s.current_draft_revision_id,
         s.published_revision_id, s.version, s.submitted_at, s.published_at, s.archived_at,
         s.created_at, s.updated_at, r.title, r.excerpt,
         (
           select coalesce(jsonb_agg(jsonb_build_object(
             'region_name', reg.name, 'destination_name', dest.name
           ) order by loc.sort_order), '[]'::jsonb)
           from public.story_revision_locations loc
           join public.regions reg on reg.id = loc.region_id
           left join public.destinations dest on dest.id = loc.destination_id
           where loc.revision_id = r.id
         ),
         (
           select cover.media_id
           from public.story_revision_media cover
           where cover.revision_id = r.id and cover.is_cover
           order by cover.sort_order, cover.id
           limit 1
         ),
         (
           select cover.alt_text
           from public.story_revision_media cover
           where cover.revision_id = r.id and cover.is_cover
           order by cover.sort_order, cover.id
           limit 1
         ),
         dr.revision_status
  from public.stories s
  left join public.contributors c on c.id = s.contributor_id
  left join public.story_revisions r on r.id = coalesce(s.current_draft_revision_id, s.published_revision_id)
  left join public.story_revisions dr on dr.id = s.current_draft_revision_id
  where (s.source_kind = 'self_submitted' and s.owner_user_id = auth.uid())
     or (s.source_kind = 'editorial_import' and c.linked_user_id = auth.uid())
  order by s.updated_at desc;
$$;

comment on function public.list_my_stories() is
  'The caller''s own stories (owner of a self_submitted story, or the linked contributor of an editorial_import), with the coalesced current-draft-or-published revision''s title, excerpt, tagged regions, and cover reference, plus the CURRENT DRAFT revision''s status (null when nothing is in flight -- deliberately not coalesced, so it only ever describes work in flight). Returns NO storage path of any kind for the cover -- only cover_media_id and cover_alt_text; the signed URL is minted separately after an independent authorization check.';

revoke execute on function public.list_my_stories() from public, anon, authenticated;
grant execute on function public.list_my_stories() to authenticated;
