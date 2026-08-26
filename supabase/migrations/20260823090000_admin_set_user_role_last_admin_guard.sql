-- Admin tooling, Phase 1 (guard): admin_set_user_role() must never be able
-- to empty the admin set.
--
-- Context for why this is here and not in the UI: admin_set_user_role() is
-- the ONLY sanctioned write path into user_roles
-- (supabase/migrations/20260802085014_user_roles.sql -- the table has no
-- INSERT/UPDATE/DELETE policy at all, so a client physically cannot write
-- it another way). A UI-only "you are the last admin" check would therefore
-- be bypassable by any hand-crafted PostgREST call from a still-valid admin
-- session, and would not survive two admins demoting each other
-- concurrently. Per Engineering Rule 3 the database is where this has to
-- live.
--
-- Interaction with the existing self-demotion guard (kept, unchanged):
-- demoting a PEER admin stays allowed -- deliberately -- right up until the
-- write would drop the total admin count to zero, which is the only case
-- this new guard rejects. An admin locked out of their own role by mistake
-- is recoverable by another admin; an account set with no admins at all is
-- only recoverable from the SQL console, which is exactly the manual step
-- this whole phase exists to retire.
--
-- Concurrency: `for update` on the admin rows serializes two concurrent
-- demotions of two different admins. Without it, both transactions would
-- read "2 admins" and both would commit, leaving zero. With it, the second
-- blocks, then re-reads the committed state and raises.

create or replace function public.admin_set_user_role(p_target_user_id uuid, p_role public.app_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target_role public.app_role;
  v_remaining_admins integer;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Only admins can change user roles';
  end if;

  if p_target_user_id = auth.uid() and p_role <> 'admin' then
    raise exception 'Admins cannot demote themselves through this function';
  end if;

  select role into v_target_role
  from public.user_roles
  where user_id = p_target_user_id;

  if v_target_role is null then
    raise exception 'No such user_roles row for %', p_target_user_id;
  end if;

  -- Only a demotion OF an admin can shrink the admin set. Every other
  -- transition skips the lock entirely, so the common case (promoting
  -- someone, changing a non-admin's role) takes no extra contention.
  if v_target_role = 'admin' and p_role <> 'admin' then
    perform 1
    from public.user_roles
    where role = 'admin'
    for update;

    select count(*) into v_remaining_admins
    from public.user_roles
    where role = 'admin'
      and user_id <> p_target_user_id;

    if v_remaining_admins = 0 then
      raise exception 'Cannot remove the last admin — promote another admin first'
        using errcode = 'WHV02';
    end if;
  end if;

  update public.user_roles
  set role = p_role
  where user_id = p_target_user_id;
end;
$$;

comment on function public.admin_set_user_role(uuid, public.app_role) is
  'Only sanctioned way to change a role after account creation. Re-checks caller is admin server-side; blocks self-demotion; refuses any write that would leave zero admins (SQLSTATE WHV02). Peer-admin demotion remains allowed while at least one admin would remain.';

-- Pre-existing exposure, found by `get_advisors(security)` while verifying
-- this change, NOT introduced by it: `anon` held EXECUTE on this function.
-- The original migration revoked from `public`, which does not remove the
-- separate direct grant Supabase's default privileges hand to `anon` for a
-- new function in the public schema (confirmed by reading pg_proc.proacl:
-- `{postgres=X,anon=X,authenticated=X,service_role=X}`).
--
-- Not exploitable -- a signed-out caller has a null auth.uid(), so
-- has_role() returns false and the first check raises -- but it is needless
-- attack surface on the single most sensitive write path in the app, and it
-- contradicts what every newer migration in this repo does (`revoke execute
-- ... from public, anon, authenticated` before an explicit grant). Removing
-- it strengthens the boundary; nothing is being weakened to make a blocker
-- go away (Engineering Rule 21).
revoke all on function public.admin_set_user_role(uuid, public.app_role) from public, anon;
grant execute on function public.admin_set_user_role(uuid, public.app_role) to authenticated;
