-- Moderation enhancement, part 2 of 2: give the moderation queue and the
-- story review page the context a moderator actually decides on.
--
-- THE PROBLEM
--
-- A queue row carried title, slug, submitted_at and a first/replacement/
-- resubmission label -- and nothing else. It did not say WHO submitted the
-- story, whether it has any content, whether it has photos, or whether the
-- story already has open reports against it. Every one of those questions
-- forced a click into the review page, and (see 20260902090000) a large
-- share of those clicks landed on an empty document.
--
-- The review page had the same gap from the other side: it renders
-- attribution snapshotted at consent time, but never names the contributor,
-- never shows when the story was submitted, never shows the contributor's
-- note to staff, and never shows the regions/tags being claimed.
--
-- WHAT THIS CHANGES
--
--   1. get_moderation_queue() -- DROP+CREATE (return shape grows). Same two
--      branches, same filters, same ordering, same clamping, same
--      authorization, same submission_kind precedence. Only the select list
--      grows, plus two columns that are meaningful in the
--      'recently_reviewed' branch only (decided_at / decision).
--   2. get_story_for_moderator() -- CREATE OR REPLACE is not possible
--      (return shape grows), so DROP+CREATE. Adds submission context, the
--      contributor identity, the contributor's note, and the claimed
--      regions/tags. ALSO FIXES a latent duplicate-row bug: it left-joined
--      story_publication_consents on revision_id alone, so a revision with
--      more than one consent event (any resubmission of the same revision)
--      returned one row PER consent event, and the page silently rendered
--      rows[0] -- which is the OLDEST event, not the current one. It now
--      takes the highest event_number, which is what
--      submit_revision_with_consent() increments.
--
-- COUNTS, NOT CONTENT. The queue returns `content_text_length` (via
-- _content_json_text_length(), the same helper the submit gate now uses),
-- never content_json itself: a page of 50 rows must not drag 50 full story
-- documents across the wire to answer "is this one empty".
--
-- PRIVACY. Everything added is either staff-workflow metadata or a field
-- already shown to moderators elsewhere. No email address, no user id of
-- the submitter, and no contributor field beyond display_name/public_slug
-- (Engineering Rule 16 governs the PUBLIC profile; this is a staff-only
-- SECURITY DEFINER function behind an explicit moderator/admin role check,
-- and display_name is the same value already snapshotted into
-- attribution_value on every consent row).

-- ---------------------------------------------------------------------------
-- 1. get_moderation_queue()
-- ---------------------------------------------------------------------------

drop function if exists public.get_moderation_queue(
  text, text, uuid, uuid, text, timestamptz, timestamptz, integer, integer
);

create function public.get_moderation_queue(
  p_status text default 'submitted',
  p_source_kind text default null,
  p_region_id uuid default null,
  p_work_type_id uuid default null,
  p_consent_method text default null,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  revision_id uuid,
  story_id uuid,
  slug text,
  title text,
  submitted_at timestamptz,
  is_replacement boolean,
  submission_kind text,
  revision_number integer,
  source_kind text,
  contributor_display_name text,
  contributor_public_slug text,
  consent_method text,
  content_text_length integer,
  image_count integer,
  location_count integer,
  tag_count integer,
  open_report_count integer,
  decided_at timestamptz,
  decision text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_offset integer;
begin
  if not (public.has_role(auth.uid(), 'moderator') or public.has_role(auth.uid(), 'admin')) then
    raise exception 'Only a moderator or admin can read the moderation queue';
  end if;
  if p_status not in ('submitted', 'recently_reviewed') then
    raise exception 'Unknown moderation queue status: %', p_status;
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 20), 50));
  v_offset := greatest(0, coalesce(p_offset, 0));

  if p_status = 'submitted' then
    return query
      select
        r.id,
        s.id,
        s.slug,
        r.title,
        s.submitted_at,
        (s.published_revision_id is not null),
        case
          when exists (
            select 1 from public.story_revisions rr
            where rr.story_id = s.id
              and rr.revision_number < r.revision_number
              and rr.revision_status in ('rejected', 'changes_requested', 'withdrawn')
          ) then 'resubmission'
          when s.published_revision_id is not null then 'replacement'
          else 'first'
        end,
        r.revision_number,
        s.source_kind::text,
        c.display_name,
        c.public_slug,
        (
          select pc.confirmation_method
          from public.story_publication_consents pc
          where pc.revision_id = r.id
          order by pc.event_number desc
          limit 1
        ),
        public._content_json_text_length(r.content_json),
        (select count(*)::integer from public.story_revision_media rm where rm.revision_id = r.id),
        (select count(*)::integer from public.story_revision_locations rl where rl.revision_id = r.id),
        (select count(*)::integer from public.story_revision_tags rt where rt.revision_id = r.id),
        (
          select count(*)::integer from public.story_reports sr
          where sr.story_id = s.id and sr.status in ('open', 'reviewing')
        ),
        null::timestamptz,
        null::text,
        count(*) over ()
      from public.story_revisions r
      join public.stories s on s.id = r.story_id
      left join public.contributors c on c.id = s.contributor_id
      where r.revision_status = 'submitted'
        and (p_source_kind is null or s.source_kind::text = p_source_kind)
        and (p_date_from is null or s.submitted_at >= p_date_from)
        and (p_date_to is null or s.submitted_at <= p_date_to)
        and (
          p_region_id is null
          or exists (
            select 1 from public.story_revision_locations l
            where l.revision_id = r.id and l.region_id = p_region_id
          )
        )
        and (
          p_work_type_id is null
          or exists (
            select 1 from public.story_revision_work_types w
            where w.revision_id = r.id and w.work_type_id = p_work_type_id
          )
        )
        and (
          p_consent_method is null
          or exists (
            select 1 from public.story_publication_consents pc2
            where pc2.revision_id = r.id and pc2.confirmation_method = p_consent_method
          )
        )
      order by s.submitted_at desc, r.id asc
      limit v_limit offset v_offset;
  else
    return query
      select
        r.id,
        s.id,
        s.slug,
        r.title,
        s.submitted_at,
        (s.published_revision_id is not null),
        case
          when exists (
            select 1 from public.story_revisions rr
            where rr.story_id = s.id
              and rr.revision_number < r.revision_number
              and rr.revision_status in ('rejected', 'changes_requested', 'withdrawn')
          ) then 'resubmission'
          when s.published_revision_id is not null then 'replacement'
          else 'first'
        end,
        r.revision_number,
        s.source_kind::text,
        c.display_name,
        c.public_slug,
        (
          select pc.confirmation_method
          from public.story_publication_consents pc
          where pc.revision_id = r.id
          order by pc.event_number desc
          limit 1
        ),
        public._content_json_text_length(r.content_json),
        (select count(*)::integer from public.story_revision_media rm where rm.revision_id = r.id),
        (select count(*)::integer from public.story_revision_locations rl where rl.revision_id = r.id),
        (select count(*)::integer from public.story_revision_tags rt where rt.revision_id = r.id),
        (
          select count(*)::integer from public.story_reports sr
          where sr.story_id = s.id and sr.status in ('open', 'reviewing')
        ),
        a.created_at,
        a.new_status::text,
        count(*) over ()
      from public.moderation_actions a
      join public.story_revisions r on r.id = a.revision_id
      join public.stories s on s.id = a.story_id
      left join public.contributors c on c.id = s.contributor_id
      where (p_source_kind is null or s.source_kind::text = p_source_kind)
        and (p_date_from is null or a.created_at >= p_date_from)
        and (p_date_to is null or a.created_at <= p_date_to)
        and (
          p_region_id is null
          or exists (
            select 1 from public.story_revision_locations l
            where l.revision_id = r.id and l.region_id = p_region_id
          )
        )
        and (
          p_work_type_id is null
          or exists (
            select 1 from public.story_revision_work_types w
            where w.revision_id = r.id and w.work_type_id = p_work_type_id
          )
        )
        and (
          p_consent_method is null
          or exists (
            select 1 from public.story_publication_consents pc2
            where pc2.revision_id = r.id and pc2.confirmation_method = p_consent_method
          )
        )
      order by a.created_at desc, a.id asc
      limit v_limit offset v_offset;
  end if;
end;
$$;

comment on function public.get_moderation_queue(
  text, text, uuid, uuid, text, timestamptz, timestamptz, integer, integer
) is
  'Moderator/admin only. Two branches: submitted (the actionable queue, newest submission first) and recently_reviewed (most recent decision first; decided_at/decision are non-null only there). Each row now carries the triage context a moderator would otherwise have to open the story to get: contributor identity, source kind, consent method, content_text_length (0 == an empty submission), image/location/tag counts and the story''s open-report count. Filters, ordering, clamping and submission_kind precedence are unchanged from 20260816090000. total_count is a window column so pagination needs no second round trip.';

revoke execute on function public.get_moderation_queue(
  text, text, uuid, uuid, text, timestamptz, timestamptz, integer, integer
) from public, anon, authenticated;
grant execute on function public.get_moderation_queue(
  text, text, uuid, uuid, text, timestamptz, timestamptz, integer, integer
) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. get_story_for_moderator()
-- ---------------------------------------------------------------------------

drop function if exists public.get_story_for_moderator(uuid);

create function public.get_story_for_moderator(p_revision_id uuid)
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
      (public._latest_valid_consent_for_revision(v_story.id, r.id) is not null),
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
  'Moderator/admin only, keyed by REVISION id. Returns the full publishable content of that exact revision plus the review context: story lifecycle/source/submitted_at, contributor identity, the contributor''s note to staff, the claimed regions and tags, a consent snapshot (never a live contributors join for attribution) and a path-free media list. As of 20260902090100 the consent snapshot is the LATEST consent event for the revision — the prior definition returned one row per event and callers silently read the oldest.';

revoke execute on function public.get_story_for_moderator(uuid) from public, anon, authenticated;
grant execute on function public.get_story_for_moderator(uuid) to authenticated;
