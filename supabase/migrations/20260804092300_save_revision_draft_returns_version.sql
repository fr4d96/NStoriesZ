-- Prompt 4 Sub-phase 4: save_revision_draft() now returns the authoritative
-- new story.version instead of void. Return-type changes are an
-- incompatible signature change (CREATE OR REPLACE cannot change a
-- function's return type), so this is a genuine DROP+CREATE, not a body-only
-- edit.
--
-- Why: components/story/story-edit-form.tsx's "fields" mutation slot
-- (queueFieldsSave -> saveRevisionFieldsAction -> saveRevisionDraft)
-- previously incremented a client-side versionRef by hand
-- (`versionRef.current += 1`) on success, trusting that the RPC always
-- bumps version by exactly 1 -- true today, but a blind client-side
-- assumption about server behavior rather than the server telling the
-- client what actually happened. Every other mutation on the form (work
-- types, tags, locations, media actions) still does the same `+= 1`
-- pattern; that is fine and unchanged, because those RPCs return nothing
-- else useful to propagate and their "unconditionally +1" behavior is
-- exactly what they document doing. This fix is scoped to the one call site
-- the Sub-phase 4 plan specifically calls out.

drop function if exists public.save_revision_draft(
  uuid, integer, text, text, jsonb, date, date, smallint, text, integer, text
);

create or replace function public.save_revision_draft(
  p_revision_id uuid,
  p_expected_version integer,
  p_title text,
  p_excerpt text default null,
  p_content_json jsonb default '[]'::jsonb,
  p_trip_start_date date default null,
  p_trip_end_date date default null,
  p_trip_year smallint default null,
  p_travel_style text default null,
  p_total_expense_nzd_cents integer default null,
  p_contributor_note text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_story_id uuid;
  v_story public.stories;
  v_new_version integer;
begin
  select story_id into v_story_id from public.story_revisions where id = p_revision_id;
  if v_story_id is null then
    raise exception 'No such revision: %', p_revision_id;
  end if;

  select * into v_story from public.stories where id = v_story_id for update;
  if v_story.version <> p_expected_version then
    raise exception 'Stale version for story % (expected %, got %)', v_story_id, v_story.version, p_expected_version;
  end if;

  if not (public._is_story_owner(v_story_id) or v_story.assigned_editor_id = auth.uid()) then
    raise exception 'Only the story owner or assigned editor can edit this revision';
  end if;
  if not public._revision_is_editable(p_revision_id) then
    raise exception 'Revision % is not currently editable', p_revision_id;
  end if;

  update public.story_revisions
  set title = p_title,
      excerpt = p_excerpt,
      content_json = coalesce(p_content_json, '[]'::jsonb),
      trip_start_date = p_trip_start_date,
      trip_end_date = p_trip_end_date,
      trip_year = p_trip_year,
      travel_style = p_travel_style,
      total_expense_nzd_cents = p_total_expense_nzd_cents,
      contributor_note = p_contributor_note,
      updated_by = auth.uid()
  where id = p_revision_id;

  update public.stories set version = version + 1 where id = v_story_id
    returning version into v_new_version;

  return v_new_version;
end;
$$;

comment on function public.save_revision_draft(
  uuid, integer, text, text, jsonb, date, date, smallint, text, integer, text
) is
  'Prompt 4 Sub-phase 4: now returns the authoritative new story.version (was void) so callers never need to assume the server incremented by exactly 1.';

revoke execute on function public.save_revision_draft(
  uuid, integer, text, text, jsonb, date, date, smallint, text, integer, text
) from public, anon, authenticated;
grant execute on function public.save_revision_draft(
  uuid, integer, text, text, jsonb, date, date, smallint, text, integer, text
) to authenticated;
