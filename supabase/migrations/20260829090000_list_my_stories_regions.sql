-- My Stories now offers client-side location filtering (Region / Destination
-- chip rows, mirroring the landing page's catalogue index), so list_my_stories()
-- needs to carry each story's tagged locations the same way list_published_stories()
-- already does (20260805100100_extend_list_published_stories.sql). Adds one
-- `regions jsonb` OUT column populated by the identical correlated subquery that
-- function uses -- the only difference is the revision it reads: here it is the
-- coalesced current-draft-or-published revision (r.id below), so an unpublished
-- draft's locations show up too.
--
-- No RLS or grant change: the function is already security definer and already
-- joins story_revisions for this same revision; regions/destinations are
-- anonymous-readable lookup tables. A story with no current/published revision
-- (r.id null) yields '[]', matching the existing null title/excerpt behaviour.
--
-- Return row shape changes (new OUT column), so DROP first -- same as the
-- 20260812100000 title/excerpt change.
drop function if exists public.list_my_stories();

create function public.list_my_stories()
returns table (
  id uuid, slug text, source_kind public.story_source_kind, visibility public.story_visibility,
  lifecycle_status public.story_lifecycle_status, current_draft_revision_id uuid,
  published_revision_id uuid, version integer, submitted_at timestamptz, published_at timestamptz,
  archived_at timestamptz, created_at timestamptz, updated_at timestamptz,
  title text, excerpt text, regions jsonb
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
         )
  from public.stories s
  left join public.contributors c on c.id = s.contributor_id
  left join public.story_revisions r on r.id = coalesce(s.current_draft_revision_id, s.published_revision_id)
  where (s.source_kind = 'self_submitted' and s.owner_user_id = auth.uid())
     or (s.source_kind = 'editorial_import' and c.linked_user_id = auth.uid())
  order by s.updated_at desc;
$$;

revoke execute on function public.list_my_stories() from public, anon, authenticated;
grant execute on function public.list_my_stories() to authenticated;
