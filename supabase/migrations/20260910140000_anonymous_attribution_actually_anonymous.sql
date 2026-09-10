-- Anonymous attribution was not anonymous. Both public story readers publish
-- the contributor's real display name, and a link to their byline page, on a
-- story the contributor asked to publish anonymously.
--
-- WHAT WAS ACTUALLY BROKEN, in the order it bites:
--
--   1. THE NAME. public.submit_story_for_review() snapshots the consent as
--      `attribution_type := v_contributor.attribution_type` but
--      `attribution_value := v_contributor.display_name` -- the real name,
--      unconditionally, including when the type is 'anonymous'
--      (20260803090700, the insert into story_publication_consents). Both
--      readers then return that value verbatim, and no PUBLIC surface reads
--      attribution_type at all: story-card.tsx and the story page render
--      `attribution_value ?? "Anonymous"`, a fallback that can never fire
--      because the column is NOT NULL. Choosing "Anonymous" on /account --
--      an option the form genuinely offers -- published your real name.
--
--   2. THE LINK. contributor_slug was gated on `public_status = 'public'`
--      alone, so an anonymously-published story rendered the word
--      "Anonymous" (or, per 1, the real name) as a LINK to that
--      contributor's byline page. One click deanonymises the author.
--      Separately, a contributor whose OWN attribution_type is 'anonymous'
--      got a link that 404s, because get_public_contributor() excludes them
--      (20260805100300, preserved by 20260910090000).
--
-- Nothing has leaked: there are currently zero consents with
-- attribution_type = 'anonymous'. This is latent, and fixed before it isn't.
--
-- FIXED IN THE READERS, NOT IN THE SNAPSHOT. The consent row keeps the true
-- attribution_value on purpose -- it is the audit record of what was agreed,
-- and /moderation/stories/[id] deliberately shows it as
-- "<value> (<type>)" when reviewing. Masking at the read boundary also fixes
-- rows that ALREADY exist, which a change to the snapshot could not.
--
-- THE RULE NOW APPLIED, uniformly, to all three identity markers:
--
--   attribution_value -- masked to NULL when THIS STORY'S consent says
--     anonymous. Gated on the consent alone, never on the contributor's
--     current setting: the consent is what the contributor agreed to for
--     this story, and someone flipping their default later should not
--     silently rewrite the byline of stories they published under their
--     name. NULL rather than the string 'Anonymous' because every caller
--     already renders `attribution_value ?? "Anonymous"` and StoryCardData
--     already types it `string | null` -- the intended design was there, it
--     had simply never been given a null to fall back on.
--
--   contributor_slug and avatar_emoji -- suppressed unless the contributor
--     has a public identity to point at AND this story is not anonymous:
--     public_status = 'public', the CONTRIBUTOR's attribution_type is not
--     'anonymous' (the same condition get_public_contributor() uses to
--     decide the byline page exists at all, so this is exactly "do not
--     advertise a page that will 404"), and the CONSENT's attribution_type
--     is not 'anonymous' (do not hand a reader a way to identify the author
--     of a story published anonymously). avatar_emoji gains the middle
--     condition here; 20260910120000 had given it only the other two.
--
-- DROP + CREATE for both, since 20260910120000 is only a day old and the
-- same rules apply: a return type that has not changed still cannot be
-- CREATE OR REPLACEd around a DROP, and a DROP takes its grants, so both are
-- re-applied at the end of each function.

-- --------------------------------------------------------------------------
-- list_published_stories
-- --------------------------------------------------------------------------

drop function if exists public.list_published_stories(
  timestamptz, uuid, integer, uuid, uuid, uuid, uuid, smallint, text, uuid,
  text, boolean, uuid, text
);

create function public.list_published_stories(
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
  contributor_avatar_emoji text,
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
      r.total_expense_nzd_cents, con.attribution_type,
      case when con.attribution_type = 'anonymous' then null else con.attribution_value end,
      case
        when c.public_status = 'public'
         and c.attribution_type <> 'anonymous'
         and con.attribution_type <> 'anonymous'
        then c.public_slug
        else null
      end,
      case
        when c.public_status = 'public'
         and c.attribution_type <> 'anonymous'
         and con.attribution_type <> 'anonymous'
        then c.avatar_emoji
        else null
      end,
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
          'region_name', reg.name,
          'destination_name', coalesce(dest.name, loc.custom_destination_label)
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
  timestamptz, uuid, integer, uuid, uuid, uuid, uuid, smallint, text, uuid,
  text, boolean, uuid, text
) from public, anon, authenticated;
grant execute on function public.list_published_stories(
  timestamptz, uuid, integer, uuid, uuid, uuid, uuid, smallint, text, uuid,
  text, boolean, uuid, text
) to anon, authenticated;

-- --------------------------------------------------------------------------
-- get_published_story
-- --------------------------------------------------------------------------

drop function if exists public.get_published_story(text);

create function public.get_published_story(p_slug text)
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
  contributor_avatar_emoji text,
  regions jsonb,
  work_types jsonb,
  tags jsonb,
  expenses jsonb
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
      v_consent.attribution_type,
      case when v_consent.attribution_type = 'anonymous' then null
           else v_consent.attribution_value end,
      case
        when v_contributor.public_status = 'public'
         and v_contributor.attribution_type <> 'anonymous'
         and v_consent.attribution_type <> 'anonymous'
        then v_contributor.public_slug
        else null
      end,
      case
        when v_contributor.public_status = 'public'
         and v_contributor.attribution_type <> 'anonymous'
         and v_consent.attribution_type <> 'anonymous'
        then v_contributor.avatar_emoji
        else null
      end,
      (
        select coalesce(jsonb_agg(jsonb_build_object(
          'region_name', reg.name,
          'destination_name', coalesce(dest.name, loc.custom_destination_label)
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
      ),
      -- The optional per-category breakdown behind the headline
      -- total_expense_nzd_cents above. Read from the PUBLISHED revision
      -- (r.id is v_story.published_revision_id, checked approved and
      -- consented above), so a draft edit to someone's budget can never
      -- appear here -- Engineering Rules 10 and 12 hold by construction
      -- rather than by a filter that could be forgotten.
      --
      -- LEFT join and coalesce, matching work_types/tags directly above: a
      -- row is either a curated expense_categories reference or a
      -- contributor-typed label (20260903110000), and an inner join would
      -- silently drop every typed one.
      (
        select coalesce(jsonb_agg(jsonb_build_object(
          'name', coalesce(ec.name, e.custom_label),
          'amount_nzd_cents', e.amount_nzd_cents,
          'note', e.note
        ) order by coalesce(ec.sort_order, 2147483647),
                   coalesce(ec.name, e.custom_label)), '[]'::jsonb)
        from public.story_revision_expenses e
        left join public.expense_categories ec on ec.id = e.category_id
        where e.revision_id = r.id
      )
    from public.story_revisions r
    where r.id = v_story.published_revision_id;
end;
$$;

revoke execute on function public.get_published_story(text) from public, anon, authenticated;
grant execute on function public.get_published_story(text) to anon, authenticated;
