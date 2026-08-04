-- Prompt 5: public contributor directory/detail. contributors uses ordinary
-- RLS (not the story domain's zero-grant model) and anon's direct table
-- grants were just revoked (20260805100000) -- these are now the only path
-- anon uses to read contributor data. A contributor's *story list* still
-- has to go through list_published_stories({contributorId}), which already
-- exists; these two functions only return the curated contributor fields
-- plus a published-story count computed against the same public+approved+
-- consent-valid invariant every public story read already uses.
--
-- Directory inclusion is intentionally narrower than "public_status =
-- 'public'" alone: excludes contributors with zero published stories (an
-- empty public profile page isn't useful and this avoids a public
-- directory of accounts with nothing to show), requires a usable
-- public_slug (needed for the /contributors/[slug] URL itself), and
-- excludes attribution_type = 'anonymous' (a contributor who chose to be
-- anonymous shouldn't also get a named public profile page -- the two are
-- in tension, and content-governance.md doesn't establish a public-profile
-- carve-out for that choice).

create or replace function public.list_public_contributors(
  p_cursor_display_name text default null,
  p_cursor_id uuid default null,
  p_limit integer default 20
)
returns table (
  contributor_id uuid,
  public_slug text,
  display_name text,
  bio text,
  published_story_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
begin
  return query
    select c.id, c.public_slug, c.display_name, c.bio, cnt.published_story_count
    from public.contributors c
    join lateral (
      select count(*) as published_story_count
      from public.stories s
      join public.story_revisions r
        on r.id = s.published_revision_id and r.story_id = s.id and r.revision_status = 'approved'
      where s.contributor_id = c.id
        and s.visibility = 'public'
        and s.lifecycle_status = 'published'
        and s.consent_revoked_at is null
        and exists (
          select 1 from public.story_publication_consents con
          where con.story_id = s.id and con.revision_id = s.published_revision_id
            and con.consent_status = 'granted'
        )
    ) cnt on true
    where c.public_status = 'public'
      and c.public_slug is not null
      and c.attribution_type <> 'anonymous'
      and cnt.published_story_count > 0
      and (
        p_cursor_display_name is null
        or (lower(c.display_name), c.id) > (lower(p_cursor_display_name), p_cursor_id)
      )
    order by lower(c.display_name) asc, c.id asc
    limit v_limit;
end;
$$;

revoke execute on function public.list_public_contributors(text, uuid, integer) from public, anon, authenticated;
grant execute on function public.list_public_contributors(text, uuid, integer) to anon, authenticated;

create or replace function public.get_public_contributor(p_slug text)
returns table (
  contributor_id uuid,
  public_slug text,
  display_name text,
  bio text,
  published_story_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
    select c.id, c.public_slug, c.display_name, c.bio, cnt.published_story_count
    from public.contributors c
    join lateral (
      select count(*) as published_story_count
      from public.stories s
      join public.story_revisions r
        on r.id = s.published_revision_id and r.story_id = s.id and r.revision_status = 'approved'
      where s.contributor_id = c.id
        and s.visibility = 'public'
        and s.lifecycle_status = 'published'
        and s.consent_revoked_at is null
        and exists (
          select 1 from public.story_publication_consents con
          where con.story_id = s.id and con.revision_id = s.published_revision_id
            and con.consent_status = 'granted'
        )
    ) cnt on true
    where c.public_slug = p_slug
      and c.public_status = 'public'
      and c.attribution_type <> 'anonymous'
      and cnt.published_story_count > 0;
end;
$$;

revoke execute on function public.get_public_contributor(text) from public, anon, authenticated;
grant execute on function public.get_public_contributor(text) to anon, authenticated;
