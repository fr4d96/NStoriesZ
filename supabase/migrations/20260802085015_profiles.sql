-- profiles: user-editable identity data, deliberately separate from the
-- protected `user_roles` table (Engineering Rule 4). One row per account,
-- created by the handle_new_user trigger (next migration).

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  public_slug text,
  avatar_path text,
  bio text,
  home_country_code text not null default 'MY',
  public_profile_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_length check (char_length(display_name) <= 120),
  constraint profiles_bio_length check (bio is null or char_length(bio) <= 2000),
  constraint profiles_home_country_code_format check (home_country_code ~ '^[A-Z]{2}$'),
  constraint profiles_public_slug_format check (
    public_slug is null or public_slug ~ '^[a-z0-9][a-z0-9-]{2,59}$'
  )
);

comment on table public.profiles is
  'User-editable profile data. home_country_code defaults to MY for initial onboarding but is plain reference data, not a hard-coded UI assumption.';
comment on column public.profiles.home_country_code is
  'ISO 3166-1 alpha-2 code stored as data. No countries reference table exists yet (out of scope for Prompt 2) — format-checked only.';

-- Case-insensitive uniqueness so "SomeSlug" and "someslug" cannot both be
-- claimed; NULLs (not yet enabled) are unconstrained, as Postgres unique
-- indexes allow multiple NULLs.
create unique index profiles_public_slug_unique_idx
  on public.profiles (lower(public_slug));

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

alter table public.profiles enable row level security;

-- Public visitors (and any authenticated user) can read a profile only when
-- the owner has explicitly opted in AND published a slug — mirrors
-- Engineering Rule 16 for the profiles table itself. The owner can always
-- read their own full profile regardless of the opt-in flag.
create policy "profiles: public can read opted-in profiles"
  on public.profiles
  for select
  to anon, authenticated
  using (public_profile_enabled = true and public_slug is not null);

create policy "profiles: owner reads own profile"
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = id);

-- No INSERT policy: rows are only ever created by the handle_new_user
-- trigger (SECURITY DEFINER, bypasses RLS). A user cannot create a second
-- profile for themselves or a profile for someone else.
create policy "profiles: owner updates own profile"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- No DELETE policy: profile lifecycle follows the auth.users row
-- (ON DELETE CASCADE); no self-service hard delete of just the profile row.
