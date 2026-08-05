-- Prompt 6 Stage 1: staff-only internal notes on a report, and a required
-- note for serious-category closures.
--
-- story_report_notes mirrors moderation_action_notes' shape exactly
-- (id, parent-id fk on delete restrict, internal_note not null with a
-- length check, created_by, created_at) -- staff-insert-only, no
-- update/delete, RLS enabled with zero policies, no direct API grants,
-- matching the domain-wide "every access is a SECURITY DEFINER function"
-- convention.

create table public.story_report_notes (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.story_reports (id) on delete restrict,
  internal_note text not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint story_report_notes_length check (char_length(internal_note) <= 4000)
);

comment on table public.story_report_notes is
  'Staff-only internal notes on a report. Never visible to the reporter. Insert-only via resolve_report(); read-only via get_report_notes(). No direct API grants.';

create index story_report_notes_report_id_idx on public.story_report_notes (report_id);

alter table public.story_report_notes enable row level security;
revoke all on public.story_report_notes from public, anon, authenticated;

-- resolve_report(): a new parameter changes the function's full signature
-- (Postgres resolves CREATE OR REPLACE by exact argument-type list, so
-- adding a parameter -- even a trailing DEFAULT-bearing one -- creates a
-- SECOND overload rather than replacing the original unless the old
-- signature is explicitly dropped first; this is the same DROP+CREATE
-- discipline used elsewhere in this migration set for any signature
-- change). Body diffed against the current live definition in
-- 20260803090700_story_lifecycle_functions.sql, confirmed unchanged by any
-- later migration (grepped every migration for "resolve_report" first).
--
-- "Serious" categories requiring a note on a closing decision
-- (resolved/dismissed only -- not on the reviewing transition, which is not
-- a closing decision): misinformation, unsafe_employment_advice,
-- harassment, copyright_privacy. spam_commercial/other stay optional, per
-- the brief.
drop function if exists public.resolve_report(uuid, text);

create function public.resolve_report(
  p_report_id uuid,
  p_status text,
  p_internal_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report public.story_reports;
  v_note_required boolean;
begin
  if not (public.has_role(auth.uid(), 'moderator') or public.has_role(auth.uid(), 'admin')) then
    raise exception 'Only a moderator or admin can resolve a report';
  end if;
  if p_status not in ('reviewing', 'resolved', 'dismissed') then
    raise exception 'Unknown report status: %', p_status;
  end if;

  select * into v_report from public.story_reports where id = p_report_id for update;
  if not found then raise exception 'No such report: %', p_report_id; end if;
  if v_report.status in ('resolved', 'dismissed') then
    raise exception 'Report % has already been closed', p_report_id;
  end if;

  v_note_required :=
    p_status in ('resolved', 'dismissed')
    and v_report.category in (
      'misinformation', 'unsafe_employment_advice', 'harassment', 'copyright_privacy'
    );
  if v_note_required and (p_internal_note is null or char_length(trim(p_internal_note)) = 0) then
    raise exception
      'An internal note is required to % a % report', p_status, v_report.category;
  end if;

  update public.story_reports
    set status = p_status, handled_by = auth.uid(), handled_at = now()
    where id = p_report_id;

  if p_internal_note is not null and char_length(trim(p_internal_note)) > 0 then
    insert into public.story_report_notes (report_id, internal_note, created_by)
    values (p_report_id, p_internal_note, auth.uid());
  end if;
end;
$$;

comment on function public.resolve_report(uuid, text, text) is
  'Moderator/admin only. Locks and re-checks the report is not already closed (unchanged invariant). Requires a non-empty p_internal_note when closing (resolved/dismissed, not reviewing) a report in one of the four serious categories; optional otherwise. Inserts the note in the same transaction as the status update.';

revoke execute on function public.resolve_report(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.resolve_report(uuid, text, text) to authenticated;

-- Reader: moderator/admin only, chronological. Kept as a distinct function
-- (never merged into list_reports_for_staff()/get_story_for_moderator())
-- so notes stay behind one narrow, purpose-built reader, matching the
-- moderation_action_notes precedent (no reader currently exposes those
-- directly either, but the same "narrow reader, not folded into a bigger
-- return shape" reasoning applies).
create function public.get_report_notes(p_report_id uuid)
returns setof public.story_report_notes
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.has_role(auth.uid(), 'moderator') or public.has_role(auth.uid(), 'admin')) then
    raise exception 'Only a moderator or admin can read report notes';
  end if;
  return query
    select * from public.story_report_notes
    where report_id = p_report_id
    order by created_at asc;
end;
$$;

comment on function public.get_report_notes(uuid) is
  'Moderator/admin only reader for story_report_notes, the only way to read this table besides resolve_report()''s own insert path.';

revoke execute on function public.get_report_notes(uuid) from public, anon, authenticated;
grant execute on function public.get_report_notes(uuid) to authenticated;
