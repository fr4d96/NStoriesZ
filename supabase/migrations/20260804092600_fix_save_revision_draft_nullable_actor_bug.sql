-- SECURITY BUG FIX, found via live test:rls run immediately after pushing
-- Prompt 4 Sub-phase 4's migrations, and confirmed by direct inspection of
-- the resulting data (not just the test assertion): the "another user
-- cannot read or edit the private draft" test's hijack attempt against a
-- self-service story actually SUCCEEDED -- story_revisions.title was
-- genuinely overwritten to "hijacked" with updated_by set to the attacking
-- test account, not the story's owner.
--
-- Root cause: 20260804092300_save_revision_draft_returns_version.sql's
-- DROP+CREATE (needed for the returns-integer signature change) copied the
-- ownership check as:
--
--   if not (public._is_story_owner(v_story_id) or v_story.assigned_editor_id = auth.uid()) then
--
-- -- which drops the coalesce(..., false) wrapper that
-- 20260803091100_fix_nullable_actor_boolean_logic.sql had already correctly
-- added to this exact line for this exact reason. For a self-service story,
-- assigned_editor_id is null; `null = auth.uid()` evaluates to NULL (not
-- false); `false OR NULL` = NULL; `NOT NULL` = NULL; and PL/pgSQL's
-- `if NULL then ... end if` does NOT execute the branch (NULL is treated as
-- false for control flow) -- so the RAISE EXCEPTION was silently skipped,
-- letting the ownership check pass for anyone. This restores the coalesce
-- wrapper. No other change.

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

  if not coalesce(public._is_story_owner(v_story_id) or v_story.assigned_editor_id = auth.uid(), false) then
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
  'Returns the authoritative new story.version (Prompt 4 Sub-phase 4). Fixed again here (20260804092600): the returns-integer rewrite in 20260804092300 accidentally dropped the coalesce(...,false) wrapper around the ownership check that 20260803091100 had already added, reopening the nullable-actor bug for self-service stories (null assigned_editor_id). Restored.';

revoke execute on function public.save_revision_draft(
  uuid, integer, text, text, jsonb, date, date, smallint, text, integer, text
) from public, anon, authenticated;
grant execute on function public.save_revision_draft(
  uuid, integer, text, text, jsonb, date, date, smallint, text, integer, text
) to authenticated;
