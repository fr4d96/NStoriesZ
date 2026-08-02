-- stories: stable identity + lifecycle pointer for a written story. No
-- direct PostgREST grants exist on this table for anon/authenticated, for
-- ANY role including staff — RLS is enabled with zero policies as a
-- structural backstop only. Every read and write goes through a
-- SECURITY DEFINER function defined in story_lifecycle_functions.sql /
-- story_public_reads.sql. See docs/architecture.md "Story domain access
-- model" for the full rationale.
--
-- current_draft_revision_id and published_revision_id reference
-- story_revisions, which is created in the next migration — added there via
-- ALTER TABLE, along with the pointer-integrity trigger.

create type public.story_source_kind as enum ('self_submitted', 'editorial_import');
create type public.story_visibility as enum ('private', 'public');
create type public.story_lifecycle_status as enum (
  'draft',
  'awaiting_contributor_approval',
  'pending_review',
  'changes_requested',
  'published',
  'rejected',
  'archived'
);

create table public.stories (
  id uuid primary key default gen_random_uuid(),
  contributor_id uuid not null references public.contributors (id) on delete restrict,
  owner_user_id uuid references auth.users (id) on delete set null,
  source_kind public.story_source_kind not null,
  slug text not null unique,
  visibility public.story_visibility not null default 'private',
  lifecycle_status public.story_lifecycle_status not null default 'draft',
  current_draft_revision_id uuid,
  published_revision_id uuid,
  assigned_editor_id uuid references auth.users (id) on delete set null,
  submitted_at timestamptz,
  published_at timestamptz,
  archived_at timestamptz,
  consent_revoked_at timestamptz,
  consent_revoked_by uuid references auth.users (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  constraint stories_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{2,79}$'),
  -- editorial imports may have no linked account yet (owner_user_id null);
  -- self-service stories always have an owning account.
  constraint stories_self_submitted_has_owner check (
    source_kind = 'editorial_import' or owner_user_id is not null
  )
);

comment on table public.stories is
  'Stable identity + lifecycle pointer for a story. No direct API grants for any role — every access goes through a SECURITY DEFINER function. RLS is enabled with zero policies as a structural backstop only.';
comment on column public.stories.current_draft_revision_id is
  'The single in-flight revision (draft or submitted), if any. Validated by stories_validate_revision_pointers(). Null when nothing is in flight.';
comment on column public.stories.published_revision_id is
  'The only pointer public reads ever follow. Always references an approved revision of this story, or null before first publication.';
comment on column public.stories.version is
  'Optimistic concurrency counter for the whole story (not per-revision). Checked and incremented by every mutating function.';

create index stories_published_at_id_idx on public.stories (published_at desc, id);
create index stories_assigned_editor_id_idx on public.stories (assigned_editor_id);
create index stories_lifecycle_status_idx on public.stories (lifecycle_status);
create index stories_contributor_id_idx on public.stories (contributor_id);
create index stories_owner_user_id_idx on public.stories (owner_user_id);

create trigger stories_set_updated_at
  before update on public.stories
  for each row
  execute function public.set_updated_at();

alter table public.stories enable row level security;
-- Deliberately no policies: RLS enabled = deny-all if a grant is ever added
-- by mistake. Every access path is a SECURITY DEFINER function instead.
