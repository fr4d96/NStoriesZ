-- Admin tooling, Phase 1 (read surface): the two RPCs behind /admin/users.
--
-- Why SECURITY DEFINER RPCs rather than the service-role admin client
-- (lib/supabase/admin.ts, which exists): routing this through the service
-- role would make the Next.js app the sole gatekeeper for who may list
-- accounts, which is exactly the arrangement Engineering Rule 3 rules out
-- ("RLS is the source of truth for authorization"). An admin-gated RPC
-- keeps the decision inside the database, where a hand-crafted PostgREST
-- call from a non-admin session hits the same check the UI does. Same
-- shape as has_role/admin_set_user_role/list_editorial_queue/
-- get_moderation_queue: SECURITY DEFINER, `set search_path = ''`, revoked
-- from public/anon, granted only to `authenticated`, and the admin check
-- re-derived from the database inside the function body.
--
-- Why these functions rather than an "admins read all profiles" RLS policy:
-- the data an admin actually needs (email, last_sign_in_at) lives in
-- auth.users, which is unreachable from an authenticated PostgREST client
-- at all -- no policy on public.profiles could surface it. A definer
-- function that joins auth.users + profiles + user_roles is the only way to
-- assemble this without the service role.
--
-- Scope note on Engineering Rule 16 ("public contributor profiles expose
-- only fields explicitly marked public"): that rule governs PUBLIC surfaces.
-- This is admin-only staff tooling behind a role check and a fail-closed
-- 404, and email is deliberately in scope -- it is the only human-readable
-- handle an admin has for an account. It is returned to the admin's own
-- rendered page and never logged (see lib/log.ts's hard rule, and
-- app/(admin)/admin/users/actions.ts which logs only user ids).

create function public.list_user_accounts(
  p_search text default null,
  p_role text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  user_id uuid,
  email text,
  display_name text,
  avatar_emoji text,
  role public.app_role,
  created_at timestamptz,
  last_sign_in_at timestamptz,
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
  v_search text;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Only admins can list user accounts';
  end if;

  if p_role is not null and p_role not in ('user', 'editor', 'moderator', 'admin') then
    raise exception 'Unknown role filter: %', p_role;
  end if;

  -- Same clamp convention as list_editorial_queue/get_moderation_queue: a
  -- client-supplied limit can never turn this into an unbounded scan.
  v_limit := greatest(1, least(coalesce(p_limit, 25), 50));
  v_offset := greatest(0, coalesce(p_offset, 0));
  v_search := nullif(trim(coalesce(p_search, '')), '');

  return query
    select
      u.id,
      u.email::text,
      p.display_name,
      p.avatar_emoji,
      ur.role,
      u.created_at,
      u.last_sign_in_at,
      count(*) over ()
    from auth.users u
    left join public.profiles p on p.id = u.id
    left join public.user_roles ur on ur.user_id = u.id
    where u.deleted_at is null
      and (p_role is null or ur.role::text = p_role)
      and (
        v_search is null
        or u.email::text ilike ('%' || v_search || '%')
        or p.display_name ilike ('%' || v_search || '%')
      )
    order by u.created_at desc, u.id asc
    limit v_limit offset v_offset;
end;
$$;

comment on function public.list_user_accounts(text, text, integer, integer) is
  'Admin only. Paginated account list joining auth.users + profiles + user_roles. p_search is a simple ilike substring match on email or display name; p_limit clamped to [1,50]. Soft-deleted auth accounts are excluded.';

revoke execute on function public.list_user_accounts(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.list_user_accounts(text, text, integer, integer) to authenticated;

-- Full account detail for one account. Returns at most one row; returns
-- ZERO rows (rather than raising) for an id that does not exist, so the
-- calling page can render the same flat 404 as any other unknown route --
-- an admin probing ids learns nothing from the difference between "no such
-- account" and "an account I somehow cannot see", and the caller does not
-- have to distinguish an exception from an empty result.
create function public.get_user_account_detail(p_user_id uuid)
returns table (
  user_id uuid,
  email text,
  email_confirmed_at timestamptz,
  display_name text,
  avatar_emoji text,
  home_country_code text,
  public_profile_enabled boolean,
  public_slug text,
  role public.app_role,
  role_updated_at timestamptz,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  contributor_id uuid,
  contributor_display_name text,
  contributor_public_status public.contributor_status,
  stories_owned bigint,
  stories_published bigint,
  stories_assigned_as_editor bigint,
  recent_activity jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Only admins can read account detail';
  end if;

  return query
    select
      u.id,
      u.email::text,
      u.email_confirmed_at,
      p.display_name,
      p.avatar_emoji,
      p.home_country_code,
      p.public_profile_enabled,
      p.public_slug,
      ur.role,
      ur.updated_at,
      u.created_at,
      u.last_sign_in_at,
      c.id,
      c.display_name,
      c.public_status,
      (select count(*) from public.stories s where s.owner_user_id = u.id),
      (
        select count(*)
        from public.stories s
        where s.owner_user_id = u.id
          and s.lifecycle_status = 'published'
      ),
      (select count(*) from public.stories s where s.assigned_editor_id = u.id),
      -- Recent staff activity, newest first, across the two audit trails
      -- Engineering Rule 5 keeps separate (moderation vs editorial
      -- preparation). Deliberately carries only the story id/slug, the
      -- action label, and a timestamp -- never user_facing_reason or an
      -- editorial summary, both of which are free text about a specific
      -- story's content and have their own, narrower surfaces. Empty array
      -- rather than null when there is nothing, so the UI has one shape to
      -- render.
      coalesce(
        (
          select jsonb_agg(a order by a.created_at desc)
          from (
            select
              'moderation' as kind,
              ma.story_id,
              s.slug as story_slug,
              ma.new_status::text as label,
              ma.created_at
            from public.moderation_actions ma
            join public.stories s on s.id = ma.story_id
            where ma.moderator_id = u.id
            union all
            select
              'editorial' as kind,
              ea.story_id,
              s.slug as story_slug,
              ea.action_type as label,
              ea.created_at
            from public.editorial_actions ea
            join public.stories s on s.id = ea.story_id
            where ea.editor_id = u.id
            order by created_at desc
            limit 10
          ) a
        ),
        '[]'::jsonb
      )
    from auth.users u
    left join public.profiles p on p.id = u.id
    left join public.user_roles ur on ur.user_id = u.id
    left join public.contributors c on c.linked_user_id = u.id
    where u.id = p_user_id
      and u.deleted_at is null;
end;
$$;

comment on function public.get_user_account_detail(uuid) is
  'Admin only. Full account detail for one account: identity, role, sign-in dates, linked contributor, story counts, and the 10 most recent moderation/editorial audit entries by this user. Returns zero rows for an unknown or soft-deleted id so callers can render a flat 404.';

revoke execute on function public.get_user_account_detail(uuid) from public, anon, authenticated;
grant execute on function public.get_user_account_detail(uuid) to authenticated;
