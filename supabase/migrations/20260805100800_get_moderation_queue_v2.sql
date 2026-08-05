-- Prompt 6 Stage 1: rebuild get_moderation_queue() with filters, pagination,
-- and a first/replacement/resubmission label, plus a 'recently_reviewed'
-- branch. DROP+CREATE because the return shape changes (new columns) --
-- diffed against the current live definition
-- (20260803090700_story_lifecycle_functions.sql; confirmed unchanged by any
-- later migration by grepping every migration for "get_moderation_queue"
-- before writing this).
--
-- Judgment call, documented per the brief's instruction (this is not
-- specified precisely enough in the brief to be anything else):
--
--   - p_status = 'submitted' (default): the real, actionable queue --
--     story_revisions.revision_status = 'submitted', joined to stories,
--     ordered by submitted_at asc (oldest first), then revision_id asc for
--     a stable tie-break.
--   - p_status = 'recently_reviewed': a DISTINCT branch over
--     moderation_actions (one row per past decision, not per revision),
--     joined back to story_revisions/stories for display fields, ordered by
--     moderation_actions.created_at desc (most recent decision first), then
--     id asc.
--   - Any other p_status value raises -- there is no generic "any
--     status" mode; the two branches above are what the Prompt 6 brief's
--     "first submissions, replacements, resubmissions, recently reviewed"
--     language actually names.
--
--   - is_replacement := stories.published_revision_id is not null (true if
--     the story already had a prior publication at the moment this row is
--     read -- for the recently_reviewed branch this reflects CURRENT state,
--     not the state at the time of that past decision, since the schema
--     keeps no historical snapshot of published_revision_id).
--   - submission_kind: 'resubmission' takes priority over 'replacement' --
--     if this story has ANY prior terminal revision (rejected /
--     changes_requested / withdrawn) with a lower revision_number than the
--     revision in this row, it is a resubmission regardless of whether it
--     is also technically a replacement of a live publication. Otherwise
--     'replacement' if is_replacement, else 'first'.
--
-- Pagination: p_limit clamped to [1, 50] (matching
-- list_published_stories()'s existing convention), p_offset clamped to
-- >= 0. Total row count returned as a `count(*) over()` window column
-- (documented choice over a separate count function -- one round trip,
-- consistent with how this function already returns everything a caller
-- needs in one call, matching list_published_stories()'s "everything a
-- story card needs in one call" precedent from Prompt 5).

drop function if exists public.get_moderation_queue();

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
        count(*) over ()
      from public.story_revisions r
      join public.stories s on s.id = r.story_id
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
            select 1 from public.story_publication_consents c
            where c.revision_id = r.id and c.confirmation_method = p_consent_method
          )
        )
      order by s.submitted_at asc, r.id asc
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
        count(*) over ()
      from public.moderation_actions a
      join public.story_revisions r on r.id = a.revision_id
      join public.stories s on s.id = a.story_id
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
            select 1 from public.story_publication_consents c
            where c.revision_id = r.id and c.confirmation_method = p_consent_method
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
  'Moderator/admin only. p_status = ''submitted'' (default, the real queue) or ''recently_reviewed'' (a distinct branch over moderation_actions). is_replacement/submission_kind reflect current story state at query time. p_limit clamped to [1,50]; total_count via count(*) over() for pagination. See this migration''s header comment for the exact submission_kind precedence rule.';

revoke execute on function public.get_moderation_queue(
  text, text, uuid, uuid, text, timestamptz, timestamptz, integer, integer
) from public, anon, authenticated;
grant execute on function public.get_moderation_queue(
  text, text, uuid, uuid, text, timestamptz, timestamptz, integer, integer
) to authenticated;
