-- Prompt 6 Stage 1: richer moderator review data, split across a small set
-- of purpose-built functions rather than one growing flat table, per the
-- brief's own suggestion.
--
-- get_story_for_moderator(p_revision_id): DROP+CREATE (return shape
-- changes materially -- content fields, consent snapshot, media list;
-- drops the one-row-per-moderation-action shape entirely, since that's now
-- get_story_moderation_history()). Diffed against the CURRENT live body:
-- the original definition in 20260803090700_story_lifecycle_functions.sql
-- was itself fixed once for an ambiguous-column bug in
-- 20260803091000_fix_returns_table_column_ambiguity.sql (qualifying
-- `v_story_id` references) -- confirmed that fix's shape by reading that
-- migration before writing this one, so the ambiguous-column bug class
-- documented three times in this codebase's history is not reintroduced a
-- fourth time.
--
-- Media never carries a storage path -- same convention as
-- get_story_preview()/get_published_story_media(): only media_id and
-- presentation/processing-state fields, so a moderator confirms media is
-- actually processed without ever seeing a private path over PostgREST.
--
-- Attribution/contributor display fields come from the revision's own
-- consent snapshot row (story_publication_consents, unique on revision_id)
-- -- never a live join to contributors, and never linked_user_id/created_by.

drop function if exists public.get_story_for_moderator(uuid);

create function public.get_story_for_moderator(p_revision_id uuid)
returns table (
  story_id uuid,
  revision_id uuid,
  revision_number integer,
  revision_status public.story_revision_status,
  title text,
  excerpt text,
  content_json jsonb,
  trip_start_date date,
  trip_end_date date,
  trip_year smallint,
  travel_style text,
  total_expense_nzd_cents integer,
  consent_valid boolean,
  media_processed boolean,
  attribution_type public.attribution_type,
  attribution_value text,
  confirmation_method text,
  image_rights_confirmed_at timestamptz,
  identifiable_people_state public.identifiable_people_state,
  media jsonb
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

  select r.story_id into v_story_id from public.story_revisions r where r.id = p_revision_id;
  if v_story_id is null then raise exception 'No such revision: %', p_revision_id; end if;

  return query
    select
      v_story_id,
      r.id,
      r.revision_number,
      r.revision_status,
      r.title,
      r.excerpt,
      r.content_json,
      r.trip_start_date,
      r.trip_end_date,
      r.trip_year,
      r.travel_style,
      r.total_expense_nzd_cents,
      (public._latest_valid_consent_for_revision(v_story_id, r.id) is not null),
      not exists (
        select 1 from public.story_revision_media rm
        join public.story_media m on m.id = rm.media_id
        where rm.revision_id = r.id
          and (m.approved_public_storage_path is null or m.metadata_removed_at is null)
      ),
      c.attribution_type,
      c.attribution_value,
      c.confirmation_method,
      c.image_rights_confirmed_at,
      c.identifiable_people_state,
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
    left join public.story_publication_consents c on c.revision_id = r.id
    where r.id = p_revision_id;
end;
$$;

comment on function public.get_story_for_moderator(uuid) is
  'Moderator/admin only. Core publishable content + consent snapshot (attribution/confirmation/image-rights/identifiable-people, from story_publication_consents -- never a live contributors join) + a path-free media list (alt_text/caption/is_cover/sort_order/processing_state). Moderation-action history moved to get_story_moderation_history(); editorial prep history to get_story_editorial_history(); open reports to list_reports_for_staff(p_story_id); the currently-published revision to get_published_revision_snapshot().';

revoke execute on function public.get_story_for_moderator(uuid) from public, anon, authenticated;
grant execute on function public.get_story_for_moderator(uuid) to authenticated;

-- get_story_moderation_history(story_id): every moderation_actions row for
-- the story plus its notes, moderator/admin only. Split out of the old
-- get_story_for_moderator() flat shape per the brief.
create function public.get_story_moderation_history(p_story_id uuid)
returns table (
  action_id uuid,
  revision_id uuid,
  previous_status public.story_revision_status,
  new_status public.story_revision_status,
  user_facing_reason text,
  moderator_id uuid,
  created_at timestamptz,
  internal_note text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.has_role(auth.uid(), 'moderator') or public.has_role(auth.uid(), 'admin')) then
    raise exception 'Only a moderator or admin can read moderation history';
  end if;
  return query
    select a.id, a.revision_id, a.previous_status, a.new_status, a.user_facing_reason,
           a.moderator_id, a.created_at, n.internal_note
    from public.moderation_actions a
    left join public.moderation_action_notes n on n.action_id = a.id
    where a.story_id = p_story_id
    order by a.created_at desc;
end;
$$;

comment on function public.get_story_moderation_history(uuid) is
  'Moderator/admin only. Every moderation_actions row (+ internal notes) for a story, newest first.';

revoke execute on function public.get_story_moderation_history(uuid) from public, anon, authenticated;
grant execute on function public.get_story_moderation_history(uuid) to authenticated;

-- get_story_editorial_history(story_id): every editorial_actions row for
-- the story. Moderators ARE allowed to see this (Prompt 6 review-page
-- requirement) but it stays a SEPARATE function/call, never merged into
-- get_story_for_editor()'s own notes -- Engineering Rule 5's "distinct
-- workflow, distinct audit trail" boundary is about which TABLE gets
-- written to, not about read access; a moderator reading editorial_actions
-- via its own dedicated function does not blur that boundary the way
-- folding it into get_story_for_editor() would.
create function public.get_story_editorial_history(p_story_id uuid)
returns table (
  id uuid,
  revision_id uuid,
  editor_id uuid,
  action_type text,
  summary text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.has_role(auth.uid(), 'moderator') or public.has_role(auth.uid(), 'admin')) then
    raise exception 'Only a moderator or admin can read editorial history';
  end if;
  return query
    select a.id, a.revision_id, a.editor_id, a.action_type, a.summary, a.created_at
    from public.editorial_actions a
    where a.story_id = p_story_id
    order by a.created_at desc;
end;
$$;

comment on function public.get_story_editorial_history(uuid) is
  'Moderator/admin only reader for editorial_actions -- moderators are allowed to see editorial prep history for review purposes, but this stays a separate function/call, never merged into the editor-only get_story_for_editor().';

revoke execute on function public.get_story_editorial_history(uuid) from public, anon, authenticated;
grant execute on function public.get_story_editorial_history(uuid) to authenticated;

-- get_published_revision_snapshot(story_id): the currently-published
-- revision's content, for diffing against a replacement under review.
-- Moderator/admin only -- deliberately not the anonymous get_published_story
-- (wrong shape/authorization for a staff diffing tool) and not
-- get_story_preview() (owner/editor-scoped, not staff-scoped).
create function public.get_published_revision_snapshot(p_story_id uuid)
returns table (
  revision_id uuid,
  title text,
  excerpt text,
  content_json jsonb,
  trip_start_date date,
  trip_end_date date,
  trip_year smallint,
  travel_style text,
  total_expense_nzd_cents integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_published_revision_id uuid;
begin
  if not (public.has_role(auth.uid(), 'moderator') or public.has_role(auth.uid(), 'admin')) then
    raise exception 'Only a moderator or admin can read a published revision snapshot';
  end if;

  select s.published_revision_id into v_published_revision_id
  from public.stories s where s.id = p_story_id;
  if v_published_revision_id is null then
    return;
  end if;

  return query
    select r.id, r.title, r.excerpt, r.content_json, r.trip_start_date, r.trip_end_date,
           r.trip_year, r.travel_style, r.total_expense_nzd_cents
    from public.story_revisions r
    where r.id = v_published_revision_id;
end;
$$;

comment on function public.get_published_revision_snapshot(uuid) is
  'Moderator/admin only. Returns the currently-published revision''s content fields (empty set if the story has never published), for diffing against a replacement revision under review.';

revoke execute on function public.get_published_revision_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.get_published_revision_snapshot(uuid) to authenticated;
