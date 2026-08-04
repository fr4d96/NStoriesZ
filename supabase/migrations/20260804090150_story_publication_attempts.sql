-- Prompt 4: story_publication_attempts is the trusted parent for a
-- moderator's in-progress publication of a submitted revision.
-- story_media_public_copy_attempts is the durable, retained-and-resolved
-- (never deleted) audit trail of every attempt to copy a media item's
-- processed bytes into the public bucket. See docs/architecture.md
-- "Publication attempts" for the full state machine and sequence.
--
-- Attempt ids are minted server-side by begin_story_publication_attempt()
-- (next migration) — no function anywhere accepts a client-generated
-- approval_attempt_id as the origin of a new attempt. Once minted, the id
-- is legitimately passed back to the caller and used as a reference by
-- later calls; every function receiving it re-verifies existence, active
-- status, and revision/media match before trusting it.

create type public.story_publication_attempt_status as enum ('active', 'finalized', 'abandoned');

create table public.story_publication_attempts (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.story_revisions (id) on delete restrict,
  initiated_by uuid not null references auth.users (id) on delete restrict,
  status public.story_publication_attempt_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

comment on table public.story_publication_attempts is
  'A moderator''s in-progress attempt to publish a submitted revision. Only one may be active per revision at a time (see the partial unique index below). No direct API grants — every access is a SECURITY DEFINER function.';

create unique index story_publication_attempts_one_active_per_revision_idx
  on public.story_publication_attempts (revision_id)
  where status = 'active';

create index story_publication_attempts_revision_id_idx on public.story_publication_attempts (revision_id);

alter table public.story_publication_attempts enable row level security;

create table public.story_media_public_copy_attempts (
  id uuid primary key default gen_random_uuid(),
  approval_attempt_id uuid not null references public.story_publication_attempts (id) on delete restrict,
  revision_id uuid not null references public.story_revisions (id) on delete restrict,
  media_id uuid not null references public.story_media (id) on delete restrict,
  content_hash text not null,
  public_path text not null,
  status text not null check (status in ('pending', 'copied', 'verified', 'failed')),
  attempt_count integer not null default 1,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text check (resolution in ('promoted', 'abandoned', 'superseded')),
  constraint story_media_public_copy_attempts_unique unique (approval_attempt_id, media_id)
);

comment on table public.story_media_public_copy_attempts is
  'Append-and-update, never-delete audit trail of every attempt to copy a media item''s processed bytes into the public bucket. A row is retained and marked resolved (resolution set), never deleted — this is what lets a maintenance pass find and clean up an orphaned public object left behind by an abandoned or crashed attempt. No direct API grants.';

create index story_media_public_copy_attempts_attempt_id_idx
  on public.story_media_public_copy_attempts (approval_attempt_id);
create index story_media_public_copy_attempts_media_id_idx
  on public.story_media_public_copy_attempts (media_id);
create index story_media_public_copy_attempts_unresolved_idx
  on public.story_media_public_copy_attempts (created_at)
  where resolved_at is null;

alter table public.story_media_public_copy_attempts enable row level security;

-- Consistency: revision_id must match the parent attempt's revision_id, and
-- media_id must actually be attached (via story_revision_media) to that
-- revision — never trust a caller-supplied combination that doesn't line
-- up, even though only service_role can reach these tables' writer
-- functions at all.
create or replace function public.story_media_public_copy_attempts_validate_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_attempt_revision_id uuid;
begin
  select revision_id into v_attempt_revision_id
  from public.story_publication_attempts where id = new.approval_attempt_id;
  if v_attempt_revision_id is null or v_attempt_revision_id <> new.revision_id then
    raise exception 'Copy attempt revision_id does not match its parent publication attempt';
  end if;
  if not exists (
    select 1 from public.story_revision_media
    where revision_id = new.revision_id and media_id = new.media_id
  ) then
    raise exception 'Media % is not attached to revision %', new.media_id, new.revision_id;
  end if;
  if not exists (select 1 from public.story_media where id = new.media_id and sha256 = new.content_hash) then
    raise exception 'content_hash for media % does not match its recorded sha256', new.media_id;
  end if;
  return new;
end;
$$;

create trigger story_media_public_copy_attempts_validate_consistency
  before insert or update on public.story_media_public_copy_attempts
  for each row
  execute function public.story_media_public_copy_attempts_validate_consistency();

-- Immutable resolution: once resolved_at/resolution is set, neither can
-- change — mirrors the promoted-state immutability pattern on story_media.
create or replace function public.story_media_public_copy_attempts_protect_resolution()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.resolved_at is not null then
    if new.resolved_at is distinct from old.resolved_at or new.resolution is distinct from old.resolution then
      raise exception 'Copy attempt % has already been resolved (%) and its resolution is immutable', old.id, old.resolution;
    end if;
  end if;
  return new;
end;
$$;

create trigger story_media_public_copy_attempts_protect_resolution
  before update on public.story_media_public_copy_attempts
  for each row
  execute function public.story_media_public_copy_attempts_protect_resolution();

-- Matches 20260803090900_lock_down_story_domain_grants.sql's established
-- pattern: RLS-enabled-with-zero-policies alone denies rows, but Supabase's
-- default per-table grants to anon/authenticated would still make the
-- query itself succeed (returning nothing) rather than fail outright. This
-- makes "no direct table access" literally true at the grant level for
-- these two new tables too, not merely true in effect via RLS.
revoke all on
  public.story_publication_attempts,
  public.story_media_public_copy_attempts
from public, anon, authenticated;
