-- Rate limiting for sign-in. Before this, signInAction could be hammered
-- indefinitely: nothing anywhere in the codebase counted failed attempts
-- (verified by grep before writing this). Username sign-in made that worse
-- in kind rather than degree -- a username is a far more guessable thing to
-- point a password list at than an email address nobody else knows.
--
-- WHY A TABLE AND NOT AN IN-PROCESS COUNTER: this deploys to serverless
-- functions. A Map in module scope is per-instance and dies on every cold
-- start, so it would count a fraction of the real attempts and reset itself
-- at exactly the moment an attacker is applying load. The counter has to be
-- shared state, and Postgres is already the shared state this platform has
-- (no new dependency, Engineering Rule 20).
--
-- WHY NOT THE SERVICE-ROLE CLIENT: lib/auth/username-login.ts holds the
-- only other exemption from the service-role import ban, and it earned that
-- on a specific argument -- a SECURITY DEFINER function returning an email
-- would be a bulk harvester for anyone holding the public anon key, so
-- there was no anon-safe alternative. That argument does not transfer here.
-- These functions return a boolean and a number of seconds; they disclose
-- nothing about any account, so the ordinary SECURITY DEFINER pattern is
-- correct and the privileged boundary stays at two files.
--
-- WHAT THIS DOES NOT DO, stated plainly: a per-identifier limit is
-- weaponisable. Anyone can burn a chosen account's allowance and lock its
-- owner out for the length of the window. That is inherent to per-account
-- limiting and is already possible through the sign-in form itself, which
-- is equally scriptable -- the RPC makes it cheaper, not newly possible.
-- The mitigations are that windows are short and self-healing (15 minutes,
-- no admin unlock needed), and that the per-IP check runs FIRST, so a
-- single source burns its own allowance after 25 failures and cannot go on
-- burning other people's.

create table public.auth_rate_limits (
  scope text not null,
  key_hash text not null,
  window_started_at timestamptz not null default now(),
  attempt_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (scope, key_hash),
  constraint auth_rate_limits_scope_known check (scope in ('ip', 'identifier')),
  -- Keys are SHA-256 hex, never the raw value: this table therefore holds no
  -- readable email address, username, or IP. Data minimisation, not secrecy
  -- -- the digest is unsalted and an attacker who could already read this
  -- table could confirm a guess. It is not relied on for anything.
  constraint auth_rate_limits_key_hash_format check (key_hash ~ '^[0-9a-f]{64}$'),
  constraint auth_rate_limits_count_nonnegative check (attempt_count >= 0)
);

comment on table public.auth_rate_limits is
  'Failed sign-in counters, keyed by SHA-256 of an IP or a typed identifier. No raw identifiers stored. No direct API grants -- reachable only through check_auth_rate_limit()/record_auth_failure().';

create trigger auth_rate_limits_set_updated_at
  before update on public.auth_rate_limits
  for each row
  execute function public.set_updated_at();

-- Finds the rows a prune pass wants without scanning the whole table.
create index auth_rate_limits_window_started_at_idx
  on public.auth_rate_limits (window_started_at);

-- RLS on with ZERO policies, matching how the story domain locks its tables
-- (see 20260803090900_lock_down_story_domain_grants.sql): the SECURITY
-- DEFINER functions below are the only way in, and the grants are revoked
-- outright so no role can read or write the counters directly. A readable
-- counter table would leak which accounts are under attack.
alter table public.auth_rate_limits enable row level security;

revoke all on public.auth_rate_limits from public, anon, authenticated;

/**
 * Is this key still under its allowance?
 *
 * Read-only on purpose: checking costs nothing and consumes nothing, so
 * calling it in a loop achieves precisely nothing. Only record_auth_failure()
 * moves a counter.
 */
create function public.check_auth_rate_limit(
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
  v_row public.auth_rate_limits%rowtype;
  v_window_ends timestamptz;
begin
  select * into v_row
  from public.auth_rate_limits
  where scope = p_scope and key_hash = p_key_hash;

  -- Never seen, or seen only in a window that has since closed.
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

  -- greatest(1, ...) so a caller never renders "try again in 0 seconds" on
  -- the last tick of a window.
  return query select
    false,
    greatest(1, ceil(extract(epoch from (v_window_ends - now()))))::integer;
end;
$$;

comment on function public.check_auth_rate_limit(text, text, integer, integer) is
  'Read-only allowance check. Returns (allowed, retry_after_seconds) and nothing else -- never discloses whether the key corresponds to a real account.';

/**
 * Counts one failed attempt.
 *
 * There is deliberately NO matching "clear on success". Such a function
 * would have to be callable by anon with an arbitrary key -- which is an
 * attacker resetting their own IP allowance before every guess, defeating
 * the entire mechanism. Windows expire on their own instead.
 */
create function public.record_auth_failure(
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
  insert into public.auth_rate_limits as arl
    (scope, key_hash, window_started_at, attempt_count)
  values (p_scope, p_key_hash, now(), 1)
  on conflict (scope, key_hash) do update
    set
      -- A window that has already closed starts over at 1; an open one
      -- keeps counting. Both branches test the STORED window start, so two
      -- concurrent failures cannot each decide the window is fresh.
      window_started_at = case
        when arl.window_started_at
             <= now() - make_interval(secs => p_window_seconds)
        then now()
        else arl.window_started_at
      end,
      attempt_count = case
        when arl.window_started_at
             <= now() - make_interval(secs => p_window_seconds)
        then 1
        else arl.attempt_count + 1
      end;
end;
$$;

comment on function public.record_auth_failure(text, text, integer) is
  'Counts one failed sign-in against a key. No paired clear/reset function exists, deliberately -- see the migration header.';

/**
 * Housekeeping. Rows are bounded by the number of distinct keys ever seen,
 * and a closed window is dead weight, so this drops anything whose window
 * ended more than p_older_than_seconds ago. Not granted to anon or
 * authenticated: it is a maintenance call, not part of the sign-in path.
 */
create function public.prune_auth_rate_limits(
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
  delete from public.auth_rate_limits
  where window_started_at <= now() - make_interval(secs => p_older_than_seconds);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function public.prune_auth_rate_limits(integer) is
  'Maintenance: drops counters whose window closed long ago. Not part of the sign-in path; no anon/authenticated grant.';

-- Sign-in happens with no session, so anon must be able to call the two
-- functions on the hot path. `authenticated` too: someone with a live
-- session can still submit the sign-in form.
revoke execute on function public.check_auth_rate_limit(text, text, integer, integer) from public;
revoke execute on function public.record_auth_failure(text, text, integer) from public;
revoke execute on function public.prune_auth_rate_limits(integer) from public, anon, authenticated;

grant execute on function public.check_auth_rate_limit(text, text, integer, integer) to anon, authenticated;
grant execute on function public.record_auth_failure(text, text, integer) to anon, authenticated;
