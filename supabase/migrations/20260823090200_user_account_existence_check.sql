-- Admin tooling Phase 1, follow-up found by live verification: an admin
-- hitting /admin/users/<unknown-uuid> got a live HTTP 200 carrying the
-- not-found UI, not a real 404 -- the same soft-404 failure mode this
-- codebase has already root-caused and fixed for the public story/
-- contributor detail pages (see proxy.ts's STORY_DETAIL_PAGE_PATH comment)
-- and for the moderation detail routes. A page-based notFound() deep in an
-- RSC tree does not set the response status here.
--
-- Not a security leak -- an admin may read every account, so nothing is
-- disclosed either way -- but a 200 for a dead link is still a soft-404,
-- and this app's own standard is to return a real status.
--
-- Deliberately NOT get_user_account_detail() itself, for exactly the reason
-- can_view_moderation_review() exists rather than reusing
-- get_story_for_moderator(): the detail function builds story counts and a
-- jsonb aggregate of audit history on every call, and middleware would pay
-- that on every request just to decide a 404. This is an existence check.
--
-- Returns ZERO ROWS (never raises) for a non-admin caller as well as for an
-- unknown id, so the "error and empty both mean false, no distinction
-- leaked" shape the other can_view_* helpers use holds here too.

create function public.can_view_user_account(p_user_id uuid)
returns table (user_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
  from auth.users u
  where u.id = p_user_id
    and u.deleted_at is null
    and public.has_role(auth.uid(), 'admin');
$$;

comment on function public.can_view_user_account(uuid) is
  'Admin only, existence check for /admin/users/[id]. Returns zero rows for a non-admin caller or an unknown/soft-deleted id — never raises — so proxy.ts can turn either into the same flat 404.';

revoke execute on function public.can_view_user_account(uuid) from public, anon, authenticated;
grant execute on function public.can_view_user_account(uuid) to authenticated;
