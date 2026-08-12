-- Adds a free-text "Other" option to Work types and Tags on the story edit
-- form. story_revision_work_types/story_revision_tags were previously
-- FK-only (every row a UUID reference into the admin-managed work_types/tags
-- lookup tables, RLS on which blocks non-admin writes -- see
-- supabase/migrations/20260803090300_story_revision_relations.sql and
-- 20260803090000_lookup_tables.sql), so a contributor had no way to record a
-- work type or tag that isn't already a seeded lookup row. Each join table
-- gets a nullable custom_label column alongside the now-nullable FK column,
-- with a CHECK enforcing exactly one of the two is set per row -- a row is
-- either a reference to a real lookup row, or a contributor-authored custom
-- value, never both/neither.
--
-- The (revision_id, work_type_id)/(revision_id, tag_id) primary keys are
-- replaced with a surrogate id, since a nullable FK column can no longer be
-- part of the primary key; a partial unique index over the non-null FK rows
-- keeps the original "no duplicate reference per revision" guarantee for
-- those rows (custom rows are only ever inserted fresh via
-- set_revision_work_types/set_revision_tags below, which always deletes and
-- reinserts the full set, so duplicate custom text isn't otherwise
-- prevented -- same as free text anywhere else in this schema).

alter table public.story_revision_work_types
  add column id uuid not null default gen_random_uuid();
alter table public.story_revision_work_types
  drop constraint story_revision_work_types_pkey;
alter table public.story_revision_work_types
  add primary key (id);
alter table public.story_revision_work_types
  alter column work_type_id drop not null;
alter table public.story_revision_work_types
  add column custom_label text;
alter table public.story_revision_work_types
  add constraint story_revision_work_types_one_of check (
    (work_type_id is not null and custom_label is null)
    or (
      work_type_id is null
      and custom_label is not null
      and char_length(trim(custom_label)) > 0
      and char_length(custom_label) <= 100
    )
  );
create unique index story_revision_work_types_unique_ref
  on public.story_revision_work_types (revision_id, work_type_id)
  where work_type_id is not null;

alter table public.story_revision_tags
  add column id uuid not null default gen_random_uuid();
alter table public.story_revision_tags
  drop constraint story_revision_tags_pkey;
alter table public.story_revision_tags
  add primary key (id);
alter table public.story_revision_tags
  alter column tag_id drop not null;
alter table public.story_revision_tags
  add column custom_label text;
alter table public.story_revision_tags
  add constraint story_revision_tags_one_of check (
    (tag_id is not null and custom_label is null)
    or (
      tag_id is null
      and custom_label is not null
      and char_length(trim(custom_label)) > 0
      and char_length(custom_label) <= 100
    )
  );
create unique index story_revision_tags_unique_ref
  on public.story_revision_tags (revision_id, tag_id)
  where tag_id is not null;

-- --- Writer RPCs: uuid[] -> jsonb (each element {work_type_id | custom_label}) ---

drop function if exists public.set_revision_work_types(uuid, integer, uuid[]);

create or replace function public.set_revision_work_types(
  p_revision_id uuid, p_expected_version integer, p_work_types jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_story_id uuid;
  v_version integer;
begin
  select public._authorize_revision_edit(p_revision_id) into v_story_id;
  select version into v_version from public.stories where id = v_story_id;
  if v_version <> p_expected_version then
    raise exception 'Stale version for story % (expected %, got %)', v_story_id, v_version, p_expected_version;
  end if;

  delete from public.story_revision_work_types where revision_id = p_revision_id;
  insert into public.story_revision_work_types (revision_id, work_type_id, custom_label)
  select p_revision_id,
         nullif(rec ->> 'work_type_id', '')::uuid,
         nullif(trim(rec ->> 'custom_label'), '')
  from jsonb_array_elements(coalesce(p_work_types, '[]'::jsonb)) as rec;

  update public.stories set version = version + 1 where id = v_story_id;
end;
$$;

revoke execute on function public.set_revision_work_types(uuid, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.set_revision_work_types(uuid, integer, jsonb) to authenticated;

drop function if exists public.set_revision_tags(uuid, integer, uuid[]);

create or replace function public.set_revision_tags(
  p_revision_id uuid, p_expected_version integer, p_tags jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_story_id uuid;
  v_version integer;
begin
  select public._authorize_revision_edit(p_revision_id) into v_story_id;
  select version into v_version from public.stories where id = v_story_id;
  if v_version <> p_expected_version then
    raise exception 'Stale version for story % (expected %, got %)', v_story_id, v_version, p_expected_version;
  end if;

  delete from public.story_revision_tags where revision_id = p_revision_id;
  insert into public.story_revision_tags (revision_id, tag_id, custom_label)
  select p_revision_id,
         nullif(rec ->> 'tag_id', '')::uuid,
         nullif(trim(rec ->> 'custom_label'), '')
  from jsonb_array_elements(coalesce(p_tags, '[]'::jsonb)) as rec;

  update public.stories set version = version + 1 where id = v_story_id;
end;
$$;

revoke execute on function public.set_revision_tags(uuid, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.set_revision_tags(uuid, integer, jsonb) to authenticated;

-- --- Reader RPC: work_type_ids/tag_ids uuid[] -> work_types/tags jsonb ---

drop function if exists public.get_revision_selections(uuid);

create or replace function public.get_revision_selections(p_revision_id uuid)
returns table (
  locations jsonb,
  work_types jsonb,
  tags jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_story_id uuid;
begin
  select story_id into v_story_id from public.story_revisions where id = p_revision_id;
  if v_story_id is null then
    raise exception 'No such revision: %', p_revision_id;
  end if;

  if not (
    public._is_story_owner(v_story_id)
    or exists (
      select 1 from public.stories s
      where s.id = v_story_id and s.assigned_editor_id = auth.uid()
    )
    or public.has_role(auth.uid(), 'admin')
  ) then
    raise exception 'Not authorized to read revision % selections', p_revision_id;
  end if;

  return query
    select
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'regionId', l.region_id,
              'destinationId', l.destination_id,
              'sortOrder', l.sort_order
            )
            order by l.sort_order
          )
          from public.story_revision_locations l
          where l.revision_id = p_revision_id
        ),
        '[]'::jsonb
      ),
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'workTypeId', wt.work_type_id,
              'customLabel', wt.custom_label
            )
          )
          from public.story_revision_work_types wt
          where wt.revision_id = p_revision_id
        ),
        '[]'::jsonb
      ),
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'tagId', t.tag_id,
              'customLabel', t.custom_label
            )
          )
          from public.story_revision_tags t
          where t.revision_id = p_revision_id
        ),
        '[]'::jsonb
      );
end;
$$;

comment on function public.get_revision_selections(uuid) is
  'Reads back a revision''s selected locations/work types/tags for the authoring edit form. Same edit-rights rule as the writer RPCs (owner, linked contributor, assigned editor, admin) -- never a broader set.';

revoke execute on function public.get_revision_selections(uuid) from public, anon, authenticated;
grant execute on function public.get_revision_selections(uuid) to authenticated;

-- --- Public reads: include custom_label rows (LEFT JOIN + coalesce to the
-- --- lookup name, so a custom "Other" entry still shows up as plain text
-- --- in the same work_types/tags text array public callers already expect) ---

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
        select coalesce(jsonb_agg(coalesce(wt.name, srwt.custom_label)), '[]'::jsonb)
        from public.story_revision_work_types srwt
        left join public.work_types wt on wt.id = srwt.work_type_id
        where srwt.revision_id = r.id
      ),
      (
        select coalesce(jsonb_agg(coalesce(t.name, srt.custom_label)), '[]'::jsonb)
        from public.story_revision_tags srt
        left join public.tags t on t.id = srt.tag_id
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
  p_contributor_id uuid default null,
  p_cost_band text default null,
  p_has_reported_expense boolean default null,
  p_exclude_story_id uuid default null,
  p_search text default null
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
  contributor_slug text,
  cover_image_path text,
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
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_query tsquery;
begin
  if p_cost_band is not null and p_cost_band not in ('under_5k', '5k_15k', '15k_30k', '30k_plus') then
    raise exception 'Invalid cost band: %', p_cost_band;
  end if;

  if p_search is not null and length(trim(p_search)) > 0 then
    v_query := websearch_to_tsquery('simple', p_search);
  end if;

  return query
    select
      s.id, s.slug, r.title, r.excerpt, s.published_at, r.trip_year, r.travel_style,
      r.total_expense_nzd_cents, con.attribution_type, con.attribution_value,
      case when c.public_status = 'public' then c.public_slug else null end,
      (
        select m.approved_public_storage_path
        from public.story_revision_media rm
        join public.story_media m on m.id = rm.media_id
        where rm.revision_id = r.id
          and m.approved_public_storage_path is not null
          and m.metadata_removed_at is not null
        order by rm.is_cover desc, rm.sort_order asc
        limit 1
      ),
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
        select coalesce(jsonb_agg(coalesce(wt.name, srwt.custom_label)), '[]'::jsonb)
        from public.story_revision_work_types srwt
        left join public.work_types wt on wt.id = srwt.work_type_id
        where srwt.revision_id = r.id
      ),
      (
        select coalesce(jsonb_agg(coalesce(t.name, srt.custom_label)), '[]'::jsonb)
        from public.story_revision_tags srt
        left join public.tags t on t.id = srt.tag_id
        where srt.revision_id = r.id
      )
    from public.stories s
    join public.story_revisions r
      on r.id = s.published_revision_id and r.story_id = s.id and r.revision_status = 'approved'
    join lateral (
      select * from public.story_publication_consents spc
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
      and (p_exclude_story_id is null or s.id <> p_exclude_story_id)
      and (v_query is null or r.search_vector @@ v_query)
      and (
        p_has_reported_expense is null
        or (p_has_reported_expense and r.total_expense_nzd_cents is not null)
        or (not p_has_reported_expense and r.total_expense_nzd_cents is null)
      )
      and (
        p_cost_band is null
        or (
          r.total_expense_nzd_cents is not null
          and (
            (p_cost_band = 'under_5k' and r.total_expense_nzd_cents < 500000)
            or (p_cost_band = '5k_15k' and r.total_expense_nzd_cents >= 500000 and r.total_expense_nzd_cents < 1500000)
            or (p_cost_band = '15k_30k' and r.total_expense_nzd_cents >= 1500000 and r.total_expense_nzd_cents < 3000000)
            or (p_cost_band = '30k_plus' and r.total_expense_nzd_cents >= 3000000)
          )
        )
      )
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
  timestamptz, uuid, integer, uuid, uuid, uuid, uuid, smallint, text, uuid, text, boolean, uuid, text
) from public, anon, authenticated;
grant execute on function public.list_published_stories(
  timestamptz, uuid, integer, uuid, uuid, uuid, uuid, smallint, text, uuid, text, boolean, uuid, text
) to anon, authenticated;
