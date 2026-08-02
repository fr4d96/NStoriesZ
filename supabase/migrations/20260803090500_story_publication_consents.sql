-- story_publication_consents: append-only consent grants. Every row is a
-- genuine, immutable grant bound to one specific revision — there is
-- exactly one way to create a row (submit_revision_with_consent(), in
-- story_lifecycle_functions.sql). No standalone "offline consent recorded
-- early" path exists: an editor's preparatory evidence can be *noted* via
-- log_editorial_action() but authorizes nothing until it is re-confirmed at
-- the moment of submission, against the exact revision being submitted.
--
-- Revocation is NOT a row in this table — it's a single terminal flag on
-- stories (consent_revoked_at/consent_revoked_by, added in stories.sql),
-- since it is story-wide and needs no history beyond "did it happen, when,
-- by whom." No function ever clears it; no restoration path exists in this
-- phase.

create type public.identifiable_people_state as enum (
  'confirmed', 'not_applicable', 'pending', 'declined'
);

create table public.story_publication_consents (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.stories (id) on delete restrict,
  revision_id uuid not null references public.story_revisions (id) on delete restrict,
  contributor_id uuid not null references public.contributors (id) on delete restrict,
  event_number integer not null,
  consent_status text not null default 'granted',
  -- Snapshot at the moment of grant, not a live join to contributors — so
  -- public attribution never depends on the contributor's current profile
  -- state (see get_published_story() in story_public_reads.sql).
  attribution_type public.attribution_type not null,
  attribution_value text not null,
  confirmation_method text not null,
  publication_confirmed_at timestamptz not null,
  image_rights_confirmed_at timestamptz,
  identifiable_people_state public.identifiable_people_state not null default 'pending',
  editorial_assistance_confirmed_at timestamptz,
  terms_version text not null,
  recorded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint story_publication_consents_revision_unique unique (revision_id),
  constraint story_publication_consents_event_unique unique (story_id, event_number),
  constraint story_publication_consents_status_granted_only check (consent_status = 'granted'),
  constraint story_publication_consents_confirmation_method check (
    confirmation_method in ('account', 'email', 'written_message', 'in_person', 'other')
  ),
  constraint story_publication_consents_attribution_value_length check (
    char_length(attribution_value) between 1 and 200
  ),
  constraint story_publication_consents_terms_version_length check (
    char_length(terms_version) between 1 and 60
  )
);

comment on table public.story_publication_consents is
  'Append-only consent grants, one per revision (unique on revision_id — a revision is frozen the instant it is submitted, so binding consent to revision_id is binding to an immutable content snapshot). Only ever written by submit_revision_with_consent(). No direct API grants.';
comment on column public.story_publication_consents.consent_status is
  'Always "granted" — revocation is tracked separately as a terminal flag on stories (consent_revoked_at), not as a row here.';

create index story_publication_consents_story_id_event_idx
  on public.story_publication_consents (story_id, event_number desc);

alter table public.story_publication_consents enable row level security;
-- No policies — every access is a SECURITY DEFINER function.

-- Staff-only internal notes, structurally separated (same reasoning as
-- story_revision_editor_notes) — never visible to the contributor/owner.
create table public.story_publication_consent_notes (
  id uuid primary key default gen_random_uuid(),
  consent_id uuid not null references public.story_publication_consents (id) on delete restrict,
  internal_note text not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint story_publication_consent_notes_length check (char_length(internal_note) <= 4000)
);

comment on table public.story_publication_consent_notes is
  'Staff-only notes on a consent grant. Never visible to the contributor/owner. No direct API grants.';

create index story_publication_consent_notes_consent_id_idx
  on public.story_publication_consent_notes (consent_id);

alter table public.story_publication_consent_notes enable row level security;

-- Internal: the one place that resolves "is there a currently-valid consent
-- grant for this exact revision" — used by both the submission/approval
-- gate and the public attribution read, so they can never drift apart.
-- Because a grant row's revision_id already IS the exact revision (a
-- revision is frozen forever once submitted), a grant for one revision can
-- never be invalidated by a later grant for a different revision — only a
-- story-wide revocation invalidates everything.
create or replace function public._latest_valid_consent_for_revision(
  p_story_id uuid,
  p_revision_id uuid
)
returns public.story_publication_consents
language sql
stable
security definer
set search_path = ''
as $$
  select c.*
  from public.story_publication_consents c
  join public.stories s on s.id = c.story_id
  where c.story_id = p_story_id
    and c.revision_id = p_revision_id
    and c.consent_status = 'granted'
    and s.consent_revoked_at is null
  limit 1;
$$;

comment on function public._latest_valid_consent_for_revision(uuid, uuid) is
  'Internal: the currently-valid consent grant for a specific revision, or null if none exists or the story''s consent has been revoked. No API grants.';

revoke execute on function public._latest_valid_consent_for_revision(uuid, uuid)
  from public, anon, authenticated;
