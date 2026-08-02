-- story_revisions: versioned, publishable snapshots of a story's content.
-- Only `draft` is ever content-editable; every other status is permanently
-- frozen (see story_revisions_protect_immutable_content() below) — "going
-- back to editing" always means a brand-new revision row
-- (create_next_draft_revision(), in story_lifecycle_functions.sql), never
-- reopening this one. That is what makes a revision_id a true immutable
-- content snapshot everywhere it is referenced (consent grants, the
-- published pointer, moderation decisions).
--
-- editor_note lives in the sibling story_revision_editor_notes table, not
-- here — it must never be visible to the contributor/owner, and RLS cannot
-- hide a single column of an otherwise-readable row.

create type public.story_revision_status as enum (
  'draft',
  'submitted',
  'approved',
  'rejected',
  'changes_requested',
  'withdrawn',
  'superseded'
);

create table public.story_revisions (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.stories (id) on delete restrict,
  revision_number integer not null,
  revision_status public.story_revision_status not null default 'draft',
  title text not null,
  excerpt text,
  content_json jsonb not null default '[]'::jsonb,
  trip_start_date date,
  trip_end_date date,
  -- Independent, directly-entered — NOT derived from trip_start_date, so a
  -- year-only story (no exact dates known) is representable.
  trip_year smallint,
  travel_style text,
  total_expense_nzd_cents integer,
  currency text not null default 'NZD',
  contributor_note text,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz,
  constraint story_revisions_story_number_unique unique (story_id, revision_number),
  constraint story_revisions_title_length check (char_length(title) between 1 and 200),
  constraint story_revisions_excerpt_length check (excerpt is null or char_length(excerpt) <= 500),
  constraint story_revisions_contributor_note_length check (
    contributor_note is null or char_length(contributor_note) <= 2000
  ),
  constraint story_revisions_trip_date_order check (
    trip_start_date is null or trip_end_date is null or trip_start_date <= trip_end_date
  ),
  constraint story_revisions_trip_year_range check (
    trip_year is null or trip_year between 2000 and 2100
  ),
  constraint story_revisions_trip_year_matches check (
    trip_year is null or trip_start_date is null
    or extract(year from trip_start_date)::int = trip_year
  ),
  constraint story_revisions_expense_non_negative check (
    total_expense_nzd_cents is null or total_expense_nzd_cents >= 0
  ),
  constraint story_revisions_currency_nzd_only check (currency = 'NZD'),
  constraint story_revisions_content_json_is_array check (jsonb_typeof(content_json) = 'array')
);

comment on table public.story_revisions is
  'Versioned, publishable content snapshots. Only revision_status = draft is content-editable — every other status is frozen forever by story_revisions_protect_immutable_content(). No direct API grants for any role.';
comment on column public.story_revisions.content_json is
  'Controlled block array: paragraph | heading | quote | list only (Engineering Rule 6). No inline image blocks — images render as an ordered gallery from story_revision_media, kept deliberately separate to avoid duplicate state (see lib/validation/story.ts).';

create index story_revisions_revision_status_idx on public.story_revisions (revision_status);

create trigger story_revisions_set_updated_at
  before update on public.story_revisions
  for each row
  execute function public.set_updated_at();

-- Content is frozen the instant a revision leaves 'draft'. Applies to every
-- caller, including the lifecycle functions — they only ever touch
-- revision_status/approved_at/updated_by/updated_at on a non-draft row.
create or replace function public.story_revisions_protect_immutable_content()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.revision_status <> 'draft' then
    if new.title is distinct from old.title
      or new.excerpt is distinct from old.excerpt
      or new.content_json is distinct from old.content_json
      or new.trip_start_date is distinct from old.trip_start_date
      or new.trip_end_date is distinct from old.trip_end_date
      or new.trip_year is distinct from old.trip_year
      or new.travel_style is distinct from old.travel_style
      or new.total_expense_nzd_cents is distinct from old.total_expense_nzd_cents
      or new.contributor_note is distinct from old.contributor_note
    then
      raise exception 'Revision content is immutable once it leaves draft status (revision %)', old.id;
    end if;
  end if;
  return new;
end;
$$;

create trigger story_revisions_protect_immutable_content
  before update on public.story_revisions
  for each row
  execute function public.story_revisions_protect_immutable_content();

alter table public.story_revisions enable row level security;
-- No policies — every access is a SECURITY DEFINER function.

-- Staff-only editor notes, structurally separated from story_revisions so
-- the contributor/owner can never see them regardless of any future
-- accidental grant or join (RLS cannot hide a single column of a readable
-- row — a separate table is the only structural way to guarantee this).
create table public.story_revision_editor_notes (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.story_revisions (id) on delete restrict,
  editor_note text not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint story_revision_editor_notes_length check (char_length(editor_note) <= 4000)
);

comment on table public.story_revision_editor_notes is
  'Staff-only notes on a revision. Never visible to the contributor/owner. No direct API grants — read only via get_story_for_editor().';

create index story_revision_editor_notes_revision_id_idx
  on public.story_revision_editor_notes (revision_id);

alter table public.story_revision_editor_notes enable row level security;

-- Forward-pointer FKs from stories to story_revisions, added now that the
-- referenced table exists (circular dependency between the two tables).
alter table public.stories
  add constraint stories_current_draft_revision_id_fkey
    foreign key (current_draft_revision_id) references public.story_revisions (id) on delete restrict,
  add constraint stories_published_revision_id_fkey
    foreign key (published_revision_id) references public.story_revisions (id) on delete restrict;

-- Pointer-integrity: current_draft_revision_id must reference a
-- draft/submitted revision of the SAME story; published_revision_id must
-- reference an approved revision of the SAME story. Enforced on every
-- insert/update to stories, regardless of caller.
create or replace function public.stories_validate_revision_pointers()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.current_draft_revision_id is not null then
    if not exists (
      select 1 from public.story_revisions
      where id = new.current_draft_revision_id
        and story_id = new.id
        and revision_status in ('draft', 'submitted')
    ) then
      raise exception
        'current_draft_revision_id must reference a draft or submitted revision of the same story (story %)',
        new.id;
    end if;
  end if;

  if new.published_revision_id is not null then
    if not exists (
      select 1 from public.story_revisions
      where id = new.published_revision_id
        and story_id = new.id
        and revision_status = 'approved'
    ) then
      raise exception
        'published_revision_id must reference an approved revision of the same story (story %)',
        new.id;
    end if;
  end if;

  return new;
end;
$$;

create trigger stories_validate_revision_pointers
  before insert or update on public.stories
  for each row
  execute function public.stories_validate_revision_pointers();
