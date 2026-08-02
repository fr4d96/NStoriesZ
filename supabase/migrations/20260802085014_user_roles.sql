-- user_roles: protected role assignment, deliberately separate from
-- `profiles` (Engineering Rule 4). Every account gets exactly one row,
-- defaulted to 'user' by the handle_new_user trigger (next migration).
--
-- Mutation model: RLS grants SELECT only. No INSERT/UPDATE/DELETE policy is
-- defined for the `authenticated` role at all, so ordinary clients cannot
-- write this table under any circumstance (default-deny). The only writers
-- are:
--   - the handle_new_user trigger (SECURITY DEFINER, runs on account
--     creation, sets the initial 'user' role), and
--   - public.admin_set_user_role() (SECURITY DEFINER, defined below),
--     which re-checks the caller is an admin before writing.
-- This is what satisfies "Ordinary users cannot create, update, or delete
-- role records" and "A user cannot assign themselves a protected role" from
-- CLAUDE.md / the Prompt 2 brief — it is not just an application-level
-- check, it is structurally impossible via the client.

create type public.app_role as enum ('user', 'editor', 'moderator', 'admin');

create table public.user_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role public.app_role not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.user_roles is
  'Protected role assignment, one row per account. Never client-writable — see migration header.';

create trigger user_roles_set_updated_at
  before update on public.user_roles
  for each row
  execute function public.set_updated_at();

alter table public.user_roles enable row level security;

-- SECURITY DEFINER, explicit search_path, so it can be safely called from
-- inside RLS policies on OTHER tables without those policies recursing back
-- into user_roles' own RLS (which would otherwise need a policy that itself
-- calls this function — infinite recursion). Owned by the migration role,
-- so it bypasses RLS internally by design; it only ever reads.
create or replace function public.has_role(p_user_id uuid, p_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = p_user_id
      and role = p_role
  );
$$;

comment on function public.has_role(uuid, public.app_role) is
  'SECURITY DEFINER role check used inside RLS policies on other tables — avoids recursive RLS on user_roles itself.';

revoke all on function public.has_role(uuid, public.app_role) from public;
grant execute on function public.has_role(uuid, public.app_role) to anon, authenticated;

-- Users can see their own role (so the app can render role-aware UI);
-- admins can see everyone's role (needed for an eventual admin role-management
-- screen). Editors/moderators do not get blanket read of other users' roles.
create policy "user_roles: read own role"
  on public.user_roles
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "user_roles: admins read all roles"
  on public.user_roles
  for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- The only sanctioned write path for role changes after account creation.
-- Re-derives the caller's own role from the database (never trusts a
-- client-supplied "I am admin" claim) before allowing the write.
create or replace function public.admin_set_user_role(p_target_user_id uuid, p_role public.app_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Only admins can change user roles';
  end if;

  if p_target_user_id = auth.uid() and p_role <> 'admin' then
    raise exception 'Admins cannot demote themselves through this function';
  end if;

  update public.user_roles
  set role = p_role
  where user_id = p_target_user_id;

  if not found then
    raise exception 'No such user_roles row for %', p_target_user_id;
  end if;
end;
$$;

comment on function public.admin_set_user_role(uuid, public.app_role) is
  'Only sanctioned way to change a role after account creation. Re-checks caller is admin server-side; blocks self-demotion.';

revoke all on function public.admin_set_user_role(uuid, public.app_role) from public;
grant execute on function public.admin_set_user_role(uuid, public.app_role) to authenticated;
