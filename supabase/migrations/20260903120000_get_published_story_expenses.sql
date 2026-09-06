-- The public story page can show WHERE the money went, not just how much.
--
-- get_published_story() already returned total_expense_nzd_cents -- one lump
-- number. The per-category breakdown has existed since 20260902110100 and
-- has been enterable in the editor since, but no public read returned it, so
-- no reader could see any of it.
--
-- Nothing about the trust boundary changes. The breakdown is read from
-- r.id, which is v_story.published_revision_id -- already checked to be
-- `approved`, already checked for a valid publication consent, and the whole
-- function already returns nothing for an unpublished, non-public or
-- consent-revoked story. A draft edit to a budget therefore cannot surface
-- here (Rules 10-12) because there is no code path that reads a draft
-- revision, not because a filter says so.
--
-- DROP + CREATE, not CREATE OR REPLACE: adding an OUT column changes the
-- return type, which replace cannot do (same as 20260902110400).

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
