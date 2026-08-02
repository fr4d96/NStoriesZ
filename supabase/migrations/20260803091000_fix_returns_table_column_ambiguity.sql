-- Bug fix, found via the RLS integration suite: PL/pgSQL treats a
-- `returns table (...)` function's output columns as implicit variables in
-- scope for the whole function body. Any bare (unqualified) column
-- reference inside a SQL statement that happens to share a name with one of
-- those output columns — e.g. `where slug = p_slug` inside a function that
-- `returns table (slug text, ...)` — is ambiguous and raises
-- "column reference is ambiguous" (SQLSTATE 42702) at call time, not at
-- migration-apply time (the CREATE FUNCTION itself succeeds). Fixed by
-- qualifying every such reference with a table alias. Functions written in
-- `language sql` (list_my_stories, the internal `_` helpers) are not
-- affected — this is specifically a PL/pgSQL variable-resolution behavior.

create or replace function public.get_published_story(p_slug text)
returns table (
  story_id uuid,
  slug text,
  title text,
  excerpt text,
  content_json jsonb,
  trip_start_date date,
  trip_end_date date,
  trip_year smallint,
  travel_style text,
  total_expense_nzd_cents integer,
  published_at timestamptz,
  attribution_type public.attribution_type,
  attribution_value text,
  contributor_slug text,
  regions jsonb,
  work_types jsonb,
  tags jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_story public.stories;
  v_consent public.story_publication_consents;
  v_contributor public.contributors;
begin
  select st.* into v_story from public.stories st
    where st.slug = p_slug and st.visibility = 'public' and st.lifecycle_status = 'published';
  if not found or v_story.published_revision_id is null or v_story.consent_revoked_at is not null then
    return;
  end if;

  if not exists (
    select 1 from public.story_revisions sr
    where sr.id = v_story.published_revision_id
      and sr.story_id = v_story.id
      and sr.revision_status = 'approved'
  ) then
    return;
  end if;

  v_consent := public._latest_valid_consent_for_revision(v_story.id, v_story.published_revision_id);
  if v_consent is null then
    return;
  end if;

  select * into v_contributor from public.contributors where id = v_story.contributor_id;

  return query
    select
      v_story.id, v_story.slug, r.title, r.excerpt, r.content_json, r.trip_start_date, r.trip_end_date,
      r.trip_year, r.travel_style, r.total_expense_nzd_cents, v_story.published_at,
      v_consent.attribution_type, v_consent.attribution_value,
      case when v_contributor.public_status = 'public' then v_contributor.public_slug else null end,
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
        select coalesce(jsonb_agg(wt.name), '[]'::jsonb)
        from public.story_revision_work_types srwt
        join public.work_types wt on wt.id = srwt.work_type_id
        where srwt.revision_id = r.id
      ),
      (
        select coalesce(jsonb_agg(t.name), '[]'::jsonb)
        from public.story_revision_tags srt
        join public.tags t on t.id = srt.tag_id
        where srt.revision_id = r.id
      )
    from public.story_revisions r
    where r.id = v_story.published_revision_id;
end;
$$;

revoke execute on function public.get_published_story(text) from public, anon, authenticated;
grant execute on function public.get_published_story(text) to anon, authenticated;

create or replace function public.list_published_stories(
  p_cursor_published_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 20,
  p_region_id uuid default null,
  p_destination_id uuid default null,
  p_work_type_id uuid default null,
  p_tag_id uuid default null,
  p_trip_year smallint default null,
  p_travel_style text default null,
  p_contributor_id uuid default null
)
returns table (
  story_id uuid,
  slug text,
  title text,
  excerpt text,
  published_at timestamptz,
  trip_year smallint,
  travel_style text,
  total_expense_nzd_cents integer,
  attribution_type public.attribution_type,
  attribution_value text,
  contributor_slug text
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
    select
      s.id, s.slug, r.title, r.excerpt, s.published_at, r.trip_year, r.travel_style,
      r.total_expense_nzd_cents, con.attribution_type, con.attribution_value,
      case when c.public_status = 'public' then c.public_slug else null end
    from public.stories s
    join public.story_revisions r
      on r.id = s.published_revision_id and r.story_id = s.id and r.revision_status = 'approved'
    join lateral (
      select spc.* from public.story_publication_consents spc
      where spc.story_id = s.id and spc.revision_id = s.published_revision_id and spc.consent_status = 'granted'
      limit 1
    ) con on true
    left join public.contributors c on c.id = s.contributor_id
    where s.visibility = 'public'
      and s.lifecycle_status = 'published'
      and s.consent_revoked_at is null
      and (p_contributor_id is null or s.contributor_id = p_contributor_id)
      and (p_trip_year is null or r.trip_year = p_trip_year)
      and (p_travel_style is null or r.travel_style = p_travel_style)
      and (
        p_work_type_id is null
        or exists (
          select 1 from public.story_revision_work_types wt
          where wt.revision_id = r.id and wt.work_type_id = p_work_type_id
        )
      )
      and (
        p_tag_id is null
        or exists (
          select 1 from public.story_revision_tags t
          where t.revision_id = r.id and t.tag_id = p_tag_id
        )
      )
      and (
        (p_region_id is null and p_destination_id is null)
        or exists (
          select 1 from public.story_revision_locations loc
          where loc.revision_id = r.id
            and (p_region_id is null or loc.region_id = p_region_id)
            and (p_destination_id is null or loc.destination_id = p_destination_id)
        )
      )
      and (
        p_cursor_published_at is null
        or (s.published_at, s.id) < (p_cursor_published_at, p_cursor_id)
      )
    order by s.published_at desc, s.id desc
    limit v_limit;
end;
$$;

revoke execute on function public.list_published_stories(
  timestamptz, uuid, integer, uuid, uuid, uuid, uuid, smallint, text, uuid
) from public, anon, authenticated;
grant execute on function public.list_published_stories(
  timestamptz, uuid, integer, uuid, uuid, uuid, uuid, smallint, text, uuid
) to anon, authenticated;

create or replace function public.get_story_for_moderator(p_revision_id uuid)
returns table (
  story_id uuid, revision_id uuid, revision_status public.story_revision_status, title text,
  consent_valid boolean, media_processed boolean,
  moderation_action_id uuid, moderation_previous_status public.story_revision_status,
  moderation_new_status public.story_revision_status, moderation_reason text,
  moderation_internal_note text, moderation_created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_story_id uuid;
begin
  if not (public.has_role(auth.uid(), 'moderator') or public.has_role(auth.uid(), 'admin')) then
    raise exception 'Only a moderator or admin can read this view';
  end if;

  select sr.story_id into v_story_id from public.story_revisions sr where sr.id = p_revision_id;
  if v_story_id is null then raise exception 'No such revision: %', p_revision_id; end if;

  return query
    select v_story_id, r.id, r.revision_status, r.title,
           (public._latest_valid_consent_for_revision(v_story_id, r.id) is not null),
           not exists (
             select 1 from public.story_revision_media rm
             join public.story_media m on m.id = rm.media_id
             where rm.revision_id = r.id
               and (m.approved_public_storage_path is null or m.metadata_removed_at is null)
           ),
           a.id, a.previous_status, a.new_status, a.user_facing_reason, n.internal_note, a.created_at
    from public.story_revisions r
    left join public.moderation_actions a on a.revision_id = r.id
    left join public.moderation_action_notes n on n.action_id = a.id
    where r.id = p_revision_id
    order by a.created_at desc;
end;
$$;

revoke execute on function public.get_story_for_moderator(uuid) from public, anon, authenticated;
grant execute on function public.get_story_for_moderator(uuid) to authenticated;
