-- Fix: `consent_valid` was false for almost every legitimately-consented
-- story.
--
-- THE BUG
--
-- `_latest_valid_consent_for_revision()` returns a COMPOSITE value (a whole
-- `story_publication_consents` row type), and get_story_for_moderator() has
-- tested it with `... is not null` since 20260803090700. For a composite,
-- Postgres defines `rowvalue IS NOT NULL` as "EVERY field is non-null" --
-- not "a row was returned". `story_publication_consents` has several
-- legitimately nullable columns, so a perfectly valid consent row reports
-- false the moment any one of them is null.
--
-- In practice that is nearly always: `image_rights_confirmed_at` is null for
-- every story with no images, and `editorial_assistance_confirmed_at` is
-- null for every self-service story. Confirmed live against revision
-- 1c1462ff (story d2c4caa4), whose consent row is present and
-- `consent_status = 'granted'`:
--
--   rowvalue is not null   -> false   (the bug)
--   (rowvalue).id is not null -> true (the truth)
--   image_rights_confirmed_at -> null (the field that poisoned it)
--
-- WHY IT SURFACED NOW, AND WHY IT IS WORTH ITS OWN MIGRATION
--
-- It is not new -- it dates to the original definition and was carried
-- through every rewrite, including 20260902090100. It went unnoticed while
-- the review page rendered it as a quiet "Consent valid: No" row in a
-- six-item <dl>. That page now renders a failed check in destructive red
-- with an alert icon, so a false negative here is actively misleading: it
-- tells a moderator to withhold publication of a story whose consent is on
-- file. A checklist that cries wolf on nearly every row is worse than no
-- checklist.
--
-- SCOPE: display only. Every OTHER caller of this helper tests
-- `... is null` as a publication GATE (moderate_revision,
-- finalize_story_publication, publish_story, get_published_story). That
-- form is correct and is deliberately left alone: for a composite,
-- `IS NULL` is true only when no row was returned at all (a returned row
-- always has a non-null `id`), which is exactly the intended meaning. Only
-- the affirmative `IS NOT NULL` reading is broken, and it appears in this
-- one function.
--
-- The fix is `(...).id is not null` -- field access on the composite, so
-- the test is "did a row come back", which is what the column has always
-- claimed to mean. Nothing else about the function changes from
-- 20260902090100.

create or replace function public.get_story_for_moderator(p_revision_id uuid)
returns table (
  story_id uuid,
  slug text,
  story_version integer,
  lifecycle_status public.story_lifecycle_status,
  source_kind text,
  submitted_at timestamptz,
  revision_id uuid,
  revision_number integer,
  revision_status public.story_revision_status,
  revision_updated_at timestamptz,
  title text,
  excerpt text,
  content_json jsonb,
  contributor_note text,
  trip_start_date date,
  trip_end_date date,
  trip_year smallint,
  travel_style text,
  total_expense_nzd_cents integer,
  contributor_display_name text,
  contributor_public_slug text,
  consent_valid boolean,
  media_processed boolean,
  attribution_type public.attribution_type,
  attribution_value text,
  confirmation_method text,
  consent_recorded_at timestamptz,
  image_rights_confirmed_at timestamptz,
  identifiable_people_state public.identifiable_people_state,
  region_names text[],
  tag_names text[],
  media jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_story public.stories;
begin
  if not (public.has_role(auth.uid(), 'moderator') or public.has_role(auth.uid(), 'admin')) then
    raise exception 'Only a moderator or admin can read this view';
  end if;

  select s.* into v_story
  from public.stories s
  join public.story_revisions r on r.story_id = s.id
  where r.id = p_revision_id;
  if not found then
    raise exception 'No such revision: %', p_revision_id;
  end if;

  return query
    select
      v_story.id,
      v_story.slug,
      v_story.version,
      v_story.lifecycle_status,
      v_story.source_kind::text,
      v_story.submitted_at,
      r.id,
      r.revision_number,
      r.revision_status,
      r.updated_at,
      r.title,
      r.excerpt,
      r.content_json,
      r.contributor_note,
      r.trip_start_date,
      r.trip_end_date,
      r.trip_year,
      r.travel_style,
      r.total_expense_nzd_cents,
      con.display_name,
      con.public_slug,
      ((public._latest_valid_consent_for_revision(v_story.id, r.id)).id is not null),
      not exists (
        select 1 from public.story_revision_media rm
        join public.story_media m on m.id = rm.media_id
        where rm.revision_id = r.id
          and (m.approved_public_storage_path is null or m.metadata_removed_at is null)
      ),
      c.attribution_type,
      c.attribution_value,
      c.confirmation_method,
      c.publication_confirmed_at,
      c.image_rights_confirmed_at,
      c.identifiable_people_state,
      coalesce(
        (
          select array_agg(distinct rg.name order by rg.name)
          from public.story_revision_locations rl
          join public.regions rg on rg.id = rl.region_id
          where rl.revision_id = r.id
        ),
        '{}'::text[]
      ),
      coalesce(
        (
          select array_agg(nm order by nm)
          from (
            select distinct coalesce(tg.name, rt.custom_label) as nm
            from public.story_revision_tags rt
            left join public.tags tg on tg.id = rt.tag_id
            where rt.revision_id = r.id
              and coalesce(tg.name, rt.custom_label) is not null
          ) as tag_names_src
        ),
        '{}'::text[]
      ),
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'mediaId', rm.media_id,
              'sortOrder', rm.sort_order,
              'isCover', rm.is_cover,
              'altText', rm.alt_text,
              'caption', rm.caption,
              'decorative', rm.decorative,
              'processingState', m.processing_state
            )
            order by rm.sort_order
          )
          from public.story_revision_media rm
          join public.story_media m on m.id = rm.media_id
          where rm.revision_id = r.id
        ),
        '[]'::jsonb
      )
    from public.story_revisions r
    left join public.contributors con on con.id = v_story.contributor_id
    -- Exactly ONE consent row: the latest event for this revision. The
    -- previous definition joined on revision_id alone, which multiplied the
    -- result row by the number of consent events and left the caller
    -- reading the oldest one.
    left join lateral (
      select pc.*
      from public.story_publication_consents pc
      where pc.revision_id = r.id
      order by pc.event_number desc
      limit 1
    ) c on true
    where r.id = p_revision_id;
end;
$$;

comment on function public.get_story_for_moderator(uuid) is
  'Moderator/admin only, keyed by REVISION id. Returns the full publishable content of that exact revision plus the review context: story lifecycle/source/submitted_at, contributor identity, the contributor''s note to staff, the claimed regions and tags, a consent snapshot (the LATEST consent event for the revision) and a path-free media list. As of 20260902090200, consent_valid tests `(...).id is not null` rather than `... is not null` on the composite the helper returns — the latter means "every field is non-null" in Postgres and reported false for any consent row with a null image-rights or editorial-assistance timestamp, i.e. nearly all of them.';

revoke execute on function public.get_story_for_moderator(uuid) from public, anon, authenticated;
grant execute on function public.get_story_for_moderator(uuid) to authenticated;
