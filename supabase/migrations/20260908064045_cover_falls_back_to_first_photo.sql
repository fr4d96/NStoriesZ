-- A story's cover falls back to its first photo instead of being absent.
--
-- THE PROBLEM, measured on the development database before this change:
-- 39 of the 42 revisions that have photos attached had no cover at all
-- (92.9%), including 4 of the 5 published stories and every one of the 6
-- stories then awaiting review -- several of which carry 6 to 12 photos.
-- Nothing ever set `is_cover`: it defaults to false, no upload path sets it,
-- the submit gate does not require it, and the only way to set one is a
-- "Set as cover" button nested inside a per-photo Details panel. So the
-- common outcome was a story with a dozen photos rendering the NoImage
-- placeholder everywhere, and shipping no og:image when shared.
--
-- THE FIX IS A READ, NOT A WRITE. Nothing stored changes and no row is
-- backfilled -- the cover is simply *resolved* as "the explicitly chosen one
-- if there is one, otherwise the first photo". Every existing story gains a
-- sensible cover the moment this ships, with nothing for any contributor to
-- redo, and an explicit choice still wins the instant someone makes one.
--
-- THIS PATTERN IS NOT NEW HERE. list_published_stories() has resolved its
-- card image exactly this way since
-- 20260903140100_custom_destination_reads_and_copy.sql:
--
--     order by rm.is_cover desc, rm.sort_order asc
--
-- with no `and is_cover` predicate. That is why the PUBLIC story index has
-- always shown photos while My Stories showed the placeholder for the same
-- story -- the two readers disagreed. This migration makes list_my_stories()
-- agree with the reader that already had it right, rather than inventing a
-- rule. The public story page's og:image is fixed in the same change on the
-- TypeScript side (app/(public)/stories/[id]/page.tsx), whose RPC
-- get_published_story_media() already returns rows in `sort_order`.
--
-- WHY sort_order AND NOT "first image embedded in the story text". The photo
-- panel's Earlier/Later controls already let a contributor arrange photos,
-- so the first one is a choice they can make without ever learning the word
-- "cover" -- and it needs no Markdown parsing in SQL. `cover.id` stays as
-- the final tiebreaker so the result is deterministic when two rows share a
-- sort_order.
--
-- DELIBERATELY NOT CHANGED: the `cover_selected` readiness metric
-- (20260907100100_private_stories.sql), which keeps its strict
-- `and m.is_cover` test. It measures whether a human CHOSE a cover, which is
-- still worth knowing to an editor; loosening it would make it true for
-- every story with a photo and tell nobody anything.
--
-- Return shape is unchanged, so this is a plain replace rather than the
-- DROP+CREATE every previous list_my_stories() migration needed. The body is
-- the live definition from 20260907110000_list_my_stories_tags.sql with the
-- two cover subqueries changed and nothing else touched -- same OUT columns,
-- same WHERE clause, same ordering, same security settings and grants.

create or replace function public.list_my_stories()
returns table (
  id uuid, slug text, source_kind public.story_source_kind, visibility public.story_visibility,
  lifecycle_status public.story_lifecycle_status, current_draft_revision_id uuid,
  published_revision_id uuid, version integer, submitted_at timestamptz, published_at timestamptz,
  archived_at timestamptz, created_at timestamptz, updated_at timestamptz,
  title text, excerpt text, regions jsonb,
  cover_media_id uuid, cover_alt_text text,
  draft_revision_status public.story_revision_status,
  tags jsonb
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
           where cover.revision_id = r.id
           order by cover.is_cover desc, cover.sort_order, cover.id
           limit 1
         ),
         (
           select cover.alt_text
           from public.story_revision_media cover
           where cover.revision_id = r.id
           order by cover.is_cover desc, cover.sort_order, cover.id
           limit 1
         ),
         dr.revision_status,
         (
           select coalesce(jsonb_agg(coalesce(t.name, srt.custom_label)), '[]'::jsonb)
           from public.story_revision_tags srt
           left join public.tags t on t.id = srt.tag_id
           where srt.revision_id = r.id
         )
  from public.stories s
  left join public.contributors c on c.id = s.contributor_id
  left join public.story_revisions r on r.id = coalesce(s.current_draft_revision_id, s.published_revision_id)
  left join public.story_revisions dr on dr.id = s.current_draft_revision_id
  where (s.source_kind = 'self_submitted' and s.owner_user_id = auth.uid())
     or (s.source_kind = 'editorial_import' and c.linked_user_id = auth.uid())
  order by s.updated_at desc;
$$;


comment on function public.list_my_stories() is
  'The caller''s own stories (owner of a self_submitted story, or the linked contributor of an editorial_import), with the coalesced current-draft-or-published revision''s title, excerpt, tagged regions, tags, and cover reference, plus the CURRENT DRAFT revision''s status (null when nothing is in flight -- deliberately not coalesced, so it only ever describes work in flight). `tags` resolves a lookup tag''s name OR the contributor''s own typed label, exactly as list_published_stories() does. The cover resolves to the explicitly chosen photo if there is one and the revision''s first photo otherwise, matching list_published_stories() -- a story with photos therefore always has a cover. Returns NO storage path of any kind for the cover -- only cover_media_id and cover_alt_text; the signed URL is minted separately after an independent authorization check.';

revoke execute on function public.list_my_stories() from public, anon, authenticated;
grant execute on function public.list_my_stories() to authenticated;
