-- get_moderation_queue()'s 'submitted' branch (20260805100800) deliberately
-- ordered oldest-first (a FIFO fairness queue, per that migration's own
-- comment) -- moderators asked for the opposite: newest submission first,
-- so the most recent activity is what's on top of the queue. This migration
-- changes ONLY that ordering, nothing else about the function's filters,
-- pagination, or return shape. The 'recently_reviewed' branch already
-- orders by `created_at desc` and is untouched.
create or replace function public.get_moderation_queue(
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
  'Moderator/admin only. Two branches: submitted (the actionable queue, newest submission first as of 20260816090000 -- previously oldest-first) and recently_reviewed (most recent decision first). Filters: source kind, region, work type, consent method, submitted/decided date range. total_count is a window column so pagination needs no second round trip.';

revoke execute on function public.get_moderation_queue(
  text, text, uuid, uuid, text, timestamptz, timestamptz, integer, integer
) from public, anon, authenticated;
grant execute on function public.get_moderation_queue(
  text, text, uuid, uuid, text, timestamptz, timestamptz, integer, integer
) to authenticated;
