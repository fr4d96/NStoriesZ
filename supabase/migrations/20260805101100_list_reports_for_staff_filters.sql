-- Prompt 6 Stage 1: reports queue filters/pagination, plus a p_story_id
-- filter -- reused here (per the brief's preference) rather than inventing
-- a separate "reports for a story" function, so
-- get_story_for_moderator()'s review page can fetch a story's open reports
-- through the same function the standalone reports queue uses.
--
-- DROP+CREATE: the new parameters change the function's full argument-type
-- signature, and CREATE OR REPLACE resolves by exact signature -- adding
-- parameters without dropping the old (text)-only signature first would
-- leave BOTH overloads callable, making a bare `list_reports_for_staff()`/
-- `list_reports_for_staff(p_status)` call ambiguous. The return shape
-- (setof story_reports) is unchanged. story_report_notes is deliberately
-- NOT joined in here -- notes stay behind get_report_notes(), the one
-- narrow reader added alongside resolve_report() in the previous migration.
drop function if exists public.list_reports_for_staff(text);

create function public.list_reports_for_staff(
  p_status text default null,
  p_category text default null,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_story_id uuid default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns setof public.story_reports
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
    raise exception 'Only a moderator or admin can list reports';
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 20), 50));
  v_offset := greatest(0, coalesce(p_offset, 0));

  return query
    select *
    from public.story_reports
    where (p_status is null or status = p_status)
      and (p_category is null or category = p_category)
      and (p_date_from is null or created_at >= p_date_from)
      and (p_date_to is null or created_at <= p_date_to)
      and (p_story_id is null or story_id = p_story_id)
    order by created_at desc, id asc
    limit v_limit offset v_offset;
end;
$$;

comment on function public.list_reports_for_staff(text, text, timestamptz, timestamptz, uuid, integer, integer) is
  'Moderator/admin only. p_story_id lets a story review page fetch its own open reports through the same function the standalone queue uses. story_report_notes is never joined here -- see get_report_notes(). p_limit clamped to [1,50], deterministic order (created_at desc, id asc).';

revoke execute on function public.list_reports_for_staff(text, text, timestamptz, timestamptz, uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.list_reports_for_staff(text, text, timestamptz, timestamptz, uuid, integer, integer)
  to authenticated;
