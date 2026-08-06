-- Release audit: a lightweight, existence-only per-row authorization check
-- for proxy.ts's /moderation/reports/[id] route, mirroring
-- can_view_moderation_review()'s established pattern exactly (see
-- 20260805110100_moderation_review_existence_check.sql). Previously flagged
-- in docs/implementation-status.md as a known, accepted gap: unlike
-- /moderation/stories/[revisionId], the reports detail page had no
-- middleware-level per-row check, so a moderator/admin hitting a
-- non-existent or wrong-storyId report id got Next's deep notFound()
-- rendered as a live HTTP 200 instead of a real 404 (same "no earlier
-- Suspense boundary" failure mode already fixed for every other staff
-- per-row route in this app). Role-level access was never bypassed -- only
-- the response status was wrong.
--
-- Deliberately not a reuse of list_reports_for_staff()/get_report_notes():
-- the former has no by-id lookup and paginates, the latter returns private
-- internal notes. This function returns nothing but the report's own id,
-- gated behind the same moderator/admin role check every other staff
-- report/moderation function already uses.

create function public.can_view_moderation_report(p_report_id uuid)
returns table (report_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.has_role(auth.uid(), 'moderator') or public.has_role(auth.uid(), 'admin')) then
    raise exception 'Only a moderator or admin can view a report detail page';
  end if;

  return query
    select r.id from public.story_reports r where r.id = p_report_id;
end;
$$;

comment on function public.can_view_moderation_report(uuid) is
  'Moderator/admin only, existence-only. Returns one row (the report id) if the report exists and the caller holds a role allowed to view report pages at all; used by proxy.ts as a cheap per-row authorization check for /moderation/reports/[id], mirroring can_view_moderation_review() for /moderation/stories/[revisionId].';

revoke execute on function public.can_view_moderation_report(uuid) from public, anon, authenticated;
grant execute on function public.can_view_moderation_report(uuid) to authenticated;
