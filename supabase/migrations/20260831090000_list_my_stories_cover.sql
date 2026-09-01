-- My Stories' grid view shows a cover thumbnail per story, but list_my_stories()
-- has never carried any media, so lib/story/contributor-queries.ts's
-- listMyStoriesWithCovers() fans out to get_story_preview() once per story via
-- Promise.all just to read one cover reference. That is an N+1: a contributor
-- with 30 drafts costs 31 round trips, and each fan-out call is far heavier
-- than the thing it is used for -- get_story_preview() builds the ENTIRE
-- preview payload every time (the revision's full content_json plus a
-- jsonb_agg of every attached media row), of which the caller keeps two
-- scalars.
--
-- Fix: return the cover directly off list_my_stories(), exactly the way the
-- `regions` column added in 20260829090000_list_my_stories_regions.sql already
-- works -- a correlated subquery against the same coalesced
-- current-draft-or-published revision (r.id) the rest of the function reads,
-- so an unpublished draft's cover shows up too. Adds exactly two trailing OUT
-- columns, `cover_media_id` and `cover_alt_text`; every existing OUT column,
-- `regions` included, is preserved unchanged.
--
-- SECURITY (Engineering Rules 2, 13, 14) -- this function returns ONLY
-- media_id and alt_text, and must never return private_storage_path,
-- approved_public_storage_path, or any other storage path. That is the same
-- rule get_story_preview() documents in its own comment. The UI passes only a
-- mediaId to StoryCoverThumbnail, which mints a signed URL separately after
-- independently re-checking authorization server-side; leaking a path here
-- would bypass that check and hand out a draft-bucket location.
--
-- Which row is "the cover": public.story_revision_media.is_cover, on the join
-- table (alt_text lives there too, per-revision, not on story_media). A
-- partial unique index -- story_revision_media_one_cover_idx on (revision_id)
-- where is_cover, from 20260803090400_story_media.sql -- already guarantees at
-- most one cover per revision, so the subquery cannot return multiple rows;
-- the `order by ... limit 1` below is belt-and-braces so this stays
-- single-valued even if that index is ever relaxed.
--
-- This selects the identical row listMyStoriesWithCovers() ends up with today.
-- get_story_preview() aggregates from story_revision_media rm joined to
-- story_media m on m.id = rm.media_id, and the TypeScript then picks
-- `.find(m => m.isCover)`. That join is not a filter -- rm.media_id is NOT NULL
-- and FK-references story_media(id) -- so reading story_revision_media alone
-- yields the same cover row, with no unused columns fetched.
--
-- No RLS, WHERE-clause, ordering, or grant change: the function is already
-- security definer with the same owner-or-linked-contributor WHERE clause, and
-- story_revision_media rows for a revision this caller already reads title and
-- excerpt from are not new information. A story with no current/published
-- revision (r.id null) or no cover yields NULL for both columns, matching the
-- existing null title/excerpt and '[]' regions behaviour.
--
-- Return row shape changes (two new OUT columns), so DROP first -- same as the
-- 20260829090000 regions change and the 20260812100000 title/excerpt change.
drop function if exists public.list_my_stories();

create function public.list_my_stories()
returns table (
  id uuid, slug text, source_kind public.story_source_kind, visibility public.story_visibility,
  lifecycle_status public.story_lifecycle_status, current_draft_revision_id uuid,
  published_revision_id uuid, version integer, submitted_at timestamptz, published_at timestamptz,
  archived_at timestamptz, created_at timestamptz, updated_at timestamptz,
  title text, excerpt text, regions jsonb,
  cover_media_id uuid, cover_alt_text text
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
         )
  from public.stories s
  left join public.contributors c on c.id = s.contributor_id
  left join public.story_revisions r on r.id = coalesce(s.current_draft_revision_id, s.published_revision_id)
  where (s.source_kind = 'self_submitted' and s.owner_user_id = auth.uid())
     or (s.source_kind = 'editorial_import' and c.linked_user_id = auth.uid())
  order by s.updated_at desc;
$$;

comment on function public.list_my_stories() is
  'The caller''s own stories (owner of a self_submitted story, or the linked contributor of an editorial_import), with the coalesced current-draft-or-published revision''s title, excerpt, tagged regions, and cover reference. Returns NO storage path of any kind for the cover -- only cover_media_id and cover_alt_text; the signed URL is minted separately after an independent authorization check.';

revoke execute on function public.list_my_stories() from public, anon, authenticated;
grant execute on function public.list_my_stories() to authenticated;
