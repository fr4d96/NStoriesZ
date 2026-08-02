-- Moderation decisions, reports, and editorial-preparation audit trail.
-- moderation_actions and editorial_actions are append-only (no
-- update/delete for anyone, insert only via function) per Engineering Rule
-- 5 — editorial preparation is a distinct workflow/table from moderation.
-- No direct API grants on any of these — see story_lifecycle_functions.sql
-- for the functions that write and read them.

create table public.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.stories (id) on delete restrict,
  revision_id uuid not null references public.story_revisions (id) on delete restrict,
  moderator_id uuid references auth.users (id) on delete set null,
  previous_status public.story_revision_status not null,
  new_status public.story_revision_status not null,
  user_facing_reason text,
  created_at timestamptz not null default now(),
  constraint moderation_actions_reason_required_on_decline check (
    new_status not in ('rejected', 'changes_requested')
    or (user_facing_reason is not null and char_length(user_facing_reason) > 0)
  ),
  constraint moderation_actions_reason_length check (
    user_facing_reason is null or char_length(user_facing_reason) <= 2000
  )
);

comment on table public.moderation_actions is
  'Append-only moderation decision history. Immutable to everyone — only moderate_revision() inserts. No direct API grants.';

create index moderation_actions_story_id_idx on public.moderation_actions (story_id);
create index moderation_actions_revision_id_idx on public.moderation_actions (revision_id);
create index moderation_actions_moderator_id_idx on public.moderation_actions (moderator_id);

alter table public.moderation_actions enable row level security;

create table public.moderation_action_notes (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null references public.moderation_actions (id) on delete restrict,
  internal_note text not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint moderation_action_notes_length check (char_length(internal_note) <= 4000)
);

comment on table public.moderation_action_notes is
  'Staff-only notes on a moderation decision. Never visible to the contributor/owner or to editors (see get_story_for_moderator() vs get_story_for_editor() split). No direct API grants.';

create index moderation_action_notes_action_id_idx on public.moderation_action_notes (action_id);

alter table public.moderation_action_notes enable row level security;

create table public.story_reports (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.stories (id) on delete restrict,
  published_revision_id uuid not null references public.story_revisions (id) on delete restrict,
  reporter_id uuid references auth.users (id) on delete set null,
  category text not null,
  details text,
  status text not null default 'open',
  handled_by uuid references auth.users (id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now(),
  constraint story_reports_category_check check (
    category in (
      'misinformation', 'unsafe_employment_advice', 'harassment',
      'copyright_privacy', 'spam_commercial', 'other'
    )
  ),
  constraint story_reports_status_check check (
    status in ('open', 'reviewing', 'resolved', 'dismissed')
  ),
  constraint story_reports_details_length check (details is null or char_length(details) <= 2000)
);

comment on table public.story_reports is
  'Reader-submitted reports on a published story. reporter_id is nullable (on delete set null) so an account deletion never blocks — the RPC that creates a report always sets it from auth.uid() at creation time. No direct API grants.';

create index story_reports_story_id_status_idx on public.story_reports (story_id, status);
create index story_reports_reporter_id_idx on public.story_reports (reporter_id);

-- Prevent duplicate open reports by the same reporter on the same story.
create unique index story_reports_reporter_story_open_unique_idx
  on public.story_reports (reporter_id, story_id)
  where status = 'open';

alter table public.story_reports enable row level security;

create table public.editorial_actions (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.stories (id) on delete restrict,
  revision_id uuid references public.story_revisions (id) on delete restrict,
  editor_id uuid references auth.users (id) on delete set null,
  action_type text not null,
  summary text not null,
  created_at timestamptz not null default now(),
  constraint editorial_actions_summary_length check (char_length(summary) between 1 and 2000)
);

comment on table public.editorial_actions is
  'Append-only editorial-preparation audit trail — distinct from moderation_actions per Engineering Rule 5. Also where preparatory consent evidence gets noted before it is re-confirmed at submission time. No direct API grants.';

create index editorial_actions_story_id_idx on public.editorial_actions (story_id);

alter table public.editorial_actions enable row level security;
-- No policies on any table above — every access is a SECURITY DEFINER function.
