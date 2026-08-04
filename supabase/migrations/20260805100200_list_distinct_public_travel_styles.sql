-- Prompt 5: travel_style has no lookup table (free text), so filter options
-- must come from what's actually in use among *public* stories -- never a
-- hardcoded list, and never derived from private/pending content. Scans
-- the exact same public+approved+consent-valid invariant
-- list_published_stories() checks; a plain distinct-select on story_revisions
-- isn't reachable by anon anyway (zero direct grants on the story domain).

create or replace function public.list_distinct_public_travel_styles()
returns table (travel_style text)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (lower(trim(r.travel_style))) trim(r.travel_style)
  from public.stories s
  join public.story_revisions r
    on r.id = s.published_revision_id and r.story_id = s.id and r.revision_status = 'approved'
  where s.visibility = 'public'
    and s.lifecycle_status = 'published'
    and s.consent_revoked_at is null
    and r.travel_style is not null
    and length(trim(r.travel_style)) > 0
    and exists (
      select 1 from public.story_publication_consents c
      where c.story_id = s.id and c.revision_id = s.published_revision_id and c.consent_status = 'granted'
    )
  order by lower(trim(r.travel_style))
  limit 50;
$$;

revoke execute on function public.list_distinct_public_travel_styles() from public, anon, authenticated;
grant execute on function public.list_distinct_public_travel_styles() to anon, authenticated;
