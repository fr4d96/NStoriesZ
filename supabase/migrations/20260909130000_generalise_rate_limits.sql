-- Rate limiting stops being auth-only: the PDF import routes need it too, so
-- the table and its functions lose the `auth_` prefix.
--
-- WHY THE FUNCTIONS ARE RECREATED RATHER THAN RENAMED -- the important part
-- of this migration. A plpgsql function body is stored as TEXT and resolved
-- when it is CALLED, not when it is created. Renaming the table therefore
-- does NOT update `public.auth_rate_limits` inside these bodies; they simply
-- start failing at call time. And because lib/rate-limit.ts is fail-open by
-- design, that failure would be completely invisible: every sign-in, reset
-- and signup form would keep working normally while enforcing nothing at
-- all. So the bodies are rewritten against the new name explicitly, and the
-- grants re-applied (a DROP takes its grants with it).
--
-- WHAT THE PDF ROUTES NEED THAT AUTH DID NOT: they are authenticated, so the
-- key is the caller's user id, taken from the session server-side, never
-- from the request (Engineering Rule 2). That is strictly better than an IP
-- -- unspoofable, and no shared-NAT problem -- so the PDF scopes have no IP
-- twin.
--
-- Preview and attach get SEPARATE scopes on purpose. Preview is exploratory
-- and repeated (try a file, look at it, try another); attach is the
-- committed action. A shared budget would let heavy previewing block the
-- import the previewing was for, which is exactly the wrong failure.

alter table public.auth_rate_limits rename to rate_limits;

alter table public.rate_limits
  rename constraint auth_rate_limits_scope_known to rate_limits_scope_known;
alter table public.rate_limits
  rename constraint auth_rate_limits_key_hash_format to rate_limits_key_hash_format;
alter table public.rate_limits
  rename constraint auth_rate_limits_count_nonnegative to rate_limits_count_nonnegative;
alter index auth_rate_limits_window_started_at_idx
  rename to rate_limits_window_started_at_idx;
alter trigger auth_rate_limits_set_updated_at on public.rate_limits
  rename to rate_limits_set_updated_at;

alter table public.rate_limits
  drop constraint rate_limits_scope_known;

alter table public.rate_limits
  add constraint rate_limits_scope_known
  check (
    scope in (
      'ip', 'identifier',
      'reset_ip', 'reset_email',
      'signup_ip', 'signup_email',
      'pdf_preview_user', 'pdf_attach_user'
    )
  );

comment on table public.rate_limits is
  'Attempt counters keyed by SHA-256 of an IP, a typed identifier, or a user id. No raw values stored. No direct API grants -- reachable only through check_rate_limit()/record_rate_limit_attempt().';

comment on constraint rate_limits_scope_known on public.rate_limits is
  'Closed list on purpose: a typo in a scope name should fail loudly, not silently create an empty bucket that limits nothing. Buckets are per-surface so none can spend another''s allowance.';

drop function public.check_auth_rate_limit(text, text, integer, integer);
drop function public.record_auth_attempt(text, text, integer);
drop function public.prune_auth_rate_limits(integer);

create function public.check_rate_limit(
  p_scope text,
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row public.rate_limits%rowtype;
  v_window_ends timestamptz;
begin
  select * into v_row
  from public.rate_limits
  where scope = p_scope and key_hash = p_key_hash;

  if not found then
    return query select true, 0;
    return;
  end if;

  v_window_ends := v_row.window_started_at
    + make_interval(secs => p_window_seconds);

  if now() >= v_window_ends or v_row.attempt_count < p_limit then
    return query select true, 0;
    return;
  end if;

  return query select
    false,
    greatest(1, ceil(extract(epoch from (v_window_ends - now()))))::integer;
end;
$$;

create function public.record_rate_limit_attempt(
  p_scope text,
  p_key_hash text,
  p_window_seconds integer
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  insert into public.rate_limits as rl
    (scope, key_hash, window_started_at, attempt_count)
  values (p_scope, p_key_hash, now(), 1)
  on conflict (scope, key_hash) do update
    set
      window_started_at = case
        when rl.window_started_at
             <= now() - make_interval(secs => p_window_seconds)
        then now()
        else rl.window_started_at
      end,
      attempt_count = case
        when rl.window_started_at
             <= now() - make_interval(secs => p_window_seconds)
        then 1
        else rl.attempt_count + 1
      end;
end;
$$;

create function public.prune_rate_limits(
  p_older_than_seconds integer default 86400
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.rate_limits
  where window_started_at <= now() - make_interval(secs => p_older_than_seconds);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function public.check_rate_limit(text, text, integer, integer) is
  'Read-only allowance check. Returns (allowed, retry_after_seconds) and nothing else.';
comment on function public.record_rate_limit_attempt(text, text, integer) is
  'Counts one attempt against a key. Sign-in counts only FAILED attempts; reset, signup and the PDF routes count every request, because their cost lands on success. No paired clear/reset function, deliberately.';
comment on function public.prune_rate_limits(integer) is
  'Maintenance: drops counters whose window closed long ago. No anon/authenticated grant.';

-- A DROP took the old grants with it, so these are re-applied, not assumed.
revoke execute on function public.check_rate_limit(text, text, integer, integer) from public;
revoke execute on function public.record_rate_limit_attempt(text, text, integer) from public;
revoke execute on function public.prune_rate_limits(integer) from public, anon, authenticated;

grant execute on function public.check_rate_limit(text, text, integer, integer) to anon, authenticated;
grant execute on function public.record_rate_limit_attempt(text, text, integer) to anon, authenticated;
