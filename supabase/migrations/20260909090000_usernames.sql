-- Optional username, usable as a sign-in handle alongside email.
--
-- Deliberately its OWN table rather than a `profiles.username` column.
-- profiles carries the policy "profiles: public can read opted-in profiles",
-- which grants `anon` a row-level SELECT — and RLS filters ROWS, not
-- COLUMNS. A username column there would be readable by any anonymous
-- caller holding the (public) anon key via a direct
-- `GET /rest/v1/profiles?select=username`, handing out the login handle of
-- every public-profile account. That is the identical gap already
-- root-caused and fixed for contributors in
-- 20260805100000_revoke_anon_contributors_table_grants.sql. This table has
-- no anon grant and no anon policy at all, so a username is never readable
-- by anyone except its owner (Engineering Rule 16).
--
-- Nullable by design at the product level: nobody is backfilled and nothing
-- prompts for one. An account with no row here simply signs in by email,
-- exactly as before.

create table public.usernames (
  user_id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Lowercase-only, so a plain unique index below is already
  -- case-insensitive and the sign-in lookup is a plain `.eq()` with no
  -- lower() call and no case-folding surprise between "what I typed" and
  -- "what I registered". Deliberately narrower than profiles.public_slug's
  -- 3-60 shape: that one is a URL segment, this one is typed into a login
  -- box. Underscores are allowed here for the same reason (a common
  -- username convention, meaningless in a slug). The absence of '@' is
  -- load-bearing — see lib/validation/username.ts.
  constraint usernames_format check (username ~ '^[a-z0-9][a-z0-9_-]{2,29}$'),
  -- Impersonation guard. Mirrored in lib/validation/username.ts for a
  -- friendly form error; this CHECK is the non-bypassable source of truth
  -- (Engineering Rule 3). Every entry is itself a legal username under the
  -- format CHECK above -- anything shorter than 3 characters ("me") is
  -- already impossible and would be dead weight here.
  constraint usernames_not_reserved check (
    username not in (
      'admin', 'admins', 'administrator', 'moderator', 'moderators',
      'moderation', 'editor', 'editors', 'editorial', 'staff', 'support',
      'help', 'root', 'system', 'security', 'official', 'kakinotes',
      'api', 'auth', 'login', 'logout', 'signin', 'sign-in', 'signup',
      'sign-up', 'account', 'accounts', 'settings', 'null',
      'undefined', 'anonymous', 'stories', 'contributors'
    )
  )
);

comment on table public.usernames is
  'Optional sign-in handle, one row per account. Separate from profiles precisely because profiles is anon-readable for opted-in public profiles and RLS cannot hide a single column. Never exposed publicly.';
comment on column public.usernames.username is
  'Lowercase-only (CHECK), so the unique index below is case-insensitive without lower(). Cannot contain "@", which is what lets sign-in tell an email apart from a username.';

create unique index usernames_username_unique_idx
  on public.usernames (username);

create trigger usernames_set_updated_at
  before update on public.usernames
  for each row
  execute function public.set_updated_at();

alter table public.usernames enable row level security;

-- Owner-only, all three verbs. There is deliberately NO anon policy and no
-- "public can read" policy of any kind: nothing in the product ever
-- displays someone else's username.
create policy "usernames: owner reads own username"
  on public.usernames
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "usernames: owner claims own username"
  on public.usernames
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "usernames: owner updates own username"
  on public.usernames
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- No DELETE policy: the row's lifecycle follows auth.users (ON DELETE
-- CASCADE). Clearing a username is an UPDATE-to-empty at the app level
-- rather than a self-service row delete... except there is nothing to
-- update it to (the column is NOT NULL), so "remove my username" is
-- deliberately not offered yet. Adding it later means a DELETE policy
-- scoped to auth.uid() = user_id, nothing more.

-- Belt and braces alongside the missing anon policy: strip Supabase's
-- default per-table grants for anon outright, so an anonymous PostgREST
-- request is refused at the grant layer before RLS is even consulted.
revoke all on public.usernames from anon;
