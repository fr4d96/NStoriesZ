-- My Stories gains a Tags filter row beside Region and Destination, so
-- list_my_stories() has to carry each story's tags the same way it already
-- carries its locations (20260829090000_list_my_stories_regions.sql).
--
-- Adds ONE trailing OUT column, `tags jsonb`. Every existing column, the
-- WHERE clause, the ordering, the grants and the security settings are
-- preserved unchanged -- the body below is the live definition from
-- 20260902090300_list_my_stories_draft_revision_status.sql with a single
-- subquery added, extracted from that file rather than retyped.
--
-- THE SUBQUERY IS NOT NEW. It is character-for-character the one
-- list_published_stories() already uses (see
-- 20260903140100_custom_destination_reads_and_copy.sql), including the
-- `coalesce(t.name, srt.custom_label)`: a tag is EITHER a reference to a
-- `tags` lookup row OR a contributor-authored label
-- (20260812110000_work_type_tag_custom_labels.sql made tag_id nullable and
-- added custom_label, with a check constraint enforcing exactly one). A
-- filter that read only `tags.name` would silently drop every tag a
-- contributor typed themselves, which on this product is a large share of
-- them.
--
-- WHICH REVISION. `r` is the coalesced current-draft-or-published revision,
-- the same one title/excerpt/regions/cover already read -- so a draft's
-- tags are filterable before it is ever published, which is the point on a
-- page that is mostly drafts. A story with no revision at all yields '[]',
-- matching the existing regions behaviour rather than null.
--
-- No RLS or grant change: this function is already security definer, already
-- joins story_revisions for this same revision, and `tags` is an
-- anonymous-readable lookup table.
--
-- Return row shape changes (one new OUT column), so DROP first -- same as
-- every previous list_my_stories() change.
drop function if exists public.list_my_stories();

create function public.list_my_stories()
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
  'The caller''s own stories (owner of a self_submitted story, or the linked contributor of an editorial_import), with the coalesced current-draft-or-published revision''s title, excerpt, tagged regions, tags, and cover reference, plus the CURRENT DRAFT revision''s status (null when nothing is in flight -- deliberately not coalesced, so it only ever describes work in flight). `tags` resolves a lookup tag''s name OR the contributor''s own typed label, exactly as list_published_stories() does. Returns NO storage path of any kind for the cover -- only cover_media_id and cover_alt_text; the signed URL is minted separately after an independent authorization check.';

revoke execute on function public.list_my_stories() from public, anon, authenticated;
grant execute on function public.list_my_stories() to authenticated;
