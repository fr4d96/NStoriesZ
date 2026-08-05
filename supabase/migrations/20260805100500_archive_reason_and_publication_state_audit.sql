-- Prompt 6 Stage 1: archive/unpublish requires a reason, and both archiving
-- and contributor-initiated consent withdrawal now leave an audit row.
--
-- Judgment call: reused vs. new table. moderation_actions requires a
-- revision_id and a specific new_status (story_revision_status) -- archiving
-- a story is a STORY-level lifecycle event, not a revision decision (a
-- story can be archived with no in-flight revision at all, e.g. long after
-- publication), and "archived"/"consent_withdrawn" are not story_revision_status
-- values at all. Forcing this into moderation_actions would mean inventing a
-- fake revision_id or weakening its NOT NULL/CHECK constraints -- explicitly
-- against this migration's instructions. A minimal new append-only table,
-- story_publication_state_actions, is added instead: story-scoped, no
-- revision_id, two action_type values only.

create table public.story_publication_state_actions (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.stories (id) on delete restrict,
  actor_id uuid references auth.users (id) on delete set null,
  action_type text not null,
  reason text,
  note text,
  created_at timestamptz not null default now(),
  constraint story_publication_state_actions_action_type_check check (
    action_type in ('archived', 'consent_withdrawn')
  ),
  constraint story_publication_state_actions_reason_length check (
    reason is null or char_length(reason) <= 2000
  ),
  constraint story_publication_state_actions_note_length check (
    note is null or char_length(note) <= 2000
  ),
  -- Reason is required for a moderator/admin archive action, but contributor
  -- withdrawal (revoke_publication_consent()) must stay reason-free per
  -- docs/content-governance.md -- enforced here, at the table level, not
  -- just inside archive_story(), so the invariant can never silently drift
  -- if a future function also inserts 'archived' rows.
  constraint story_publication_state_actions_archived_requires_reason check (
    action_type <> 'archived' or (reason is not null and char_length(reason) > 0)
  )
);

comment on table public.story_publication_state_actions is
  'Append-only audit trail for story-level (not revision-level) lifecycle actions: archiving (reason required) and consent withdrawal (reason-free, contributor-initiated). No direct API grants -- written only by archive_story()/revoke_publication_consent().';

create index story_publication_state_actions_story_id_idx
  on public.story_publication_state_actions (story_id);

alter table public.story_publication_state_actions enable row level security;
-- No policies -- every access is a SECURITY DEFINER function, matching the
-- domain-wide convention. No direct table grants either.
revoke all on public.story_publication_state_actions from public, anon, authenticated;

-- archive_story(): DROP+CREATE because a new required parameter
-- (p_reason) cannot be added via CREATE OR REPLACE. Diffed against the
-- CURRENT live body (supabase/migrations/20260803090700_story_lifecycle_functions.sql
-- -- unchanged by any later migration, confirmed by grepping every later
-- migration for "archive_story" before writing this) rather than an earlier
-- copy, per this codebase's own documented lesson about stale-copy bugs.
drop function if exists public.archive_story(uuid, integer);

create function public.archive_story(
  p_story_id uuid,
  p_expected_version integer,
  p_reason text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_story public.stories;
begin
  if not (public.has_role(auth.uid(), 'moderator') or public.has_role(auth.uid(), 'admin')) then
    raise exception 'Only a moderator or admin can archive a story';
  end if;
  if p_reason is null or char_length(trim(p_reason)) = 0 then
    raise exception 'A reason is required to archive a story';
  end if;
  if char_length(p_reason) > 2000 then
    raise exception 'Archive reason is too long';
  end if;

  select * into v_story from public.stories where id = p_story_id for update;
  if not found then raise exception 'No such story: %', p_story_id; end if;
  if v_story.version <> p_expected_version then
    raise exception 'Stale version for story % (expected %, got %)', p_story_id, v_story.version, p_expected_version;
  end if;

  perform public._terminalize_active_revision(p_story_id);

  update public.stories
    set lifecycle_status = 'archived', archived_at = now(), version = version + 1
    where id = p_story_id;

  insert into public.story_publication_state_actions (story_id, actor_id, action_type, reason, note)
  values (p_story_id, auth.uid(), 'archived', p_reason, p_note);
end;
$$;

comment on function public.archive_story(uuid, integer, text, text) is
  'Moderator/admin only. Requires a non-empty p_reason (archiving is a user-facing decision, unlike contributor withdrawal). Locks and version-checks the story before mutating; records an append-only audit row.';

revoke execute on function public.archive_story(uuid, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.archive_story(uuid, integer, text, text) to authenticated;

-- revoke_publication_consent(): same signature (CREATE OR REPLACE is
-- sufficient), gains an audit insert. No reason parameter is added --
-- contributor-initiated withdrawal must stay reason-free per
-- docs/content-governance.md "Corrections, withdrawal, and deletion". Body
-- diffed against the current live definition in
-- 20260803090700_story_lifecycle_functions.sql (confirmed unchanged by any
-- later migration).
create or replace function public.revoke_publication_consent(p_story_id uuid, p_expected_version integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_story public.stories;
begin
  select * into v_story from public.stories where id = p_story_id for update;
  if not found then raise exception 'No such story: %', p_story_id; end if;
  if not (public._is_story_owner(p_story_id) or public.has_role(auth.uid(), 'admin')) then
    raise exception 'Only the story owner or an admin can revoke publication consent';
  end if;
  if v_story.version <> p_expected_version then
    raise exception 'Stale version for story % (expected %, got %)', p_story_id, v_story.version, p_expected_version;
  end if;
  if v_story.consent_revoked_at is not null then
    raise exception 'Consent for story % has already been revoked', p_story_id;
  end if;

  perform public._terminalize_active_revision(p_story_id);

  update public.stories
    set consent_revoked_at = now(),
        consent_revoked_by = auth.uid(),
        lifecycle_status = case when lifecycle_status = 'published' then 'archived'::public.story_lifecycle_status
                                 else lifecycle_status end,
        archived_at = case when lifecycle_status = 'published' then now() else archived_at end,
        version = version + 1
    where id = p_story_id;

  insert into public.story_publication_state_actions (story_id, actor_id, action_type, reason, note)
  values (p_story_id, auth.uid(), 'consent_withdrawn', null, null);
end;
$$;

comment on function public.revoke_publication_consent(uuid, integer) is
  'Owner or admin only. Reason-free by design (contributor-initiated withdrawal, per docs/content-governance.md) -- now records an append-only audit row alongside the existing terminal consent_revoked_at flag.';

revoke execute on function public.revoke_publication_consent(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.revoke_publication_consent(uuid, integer) to authenticated;
