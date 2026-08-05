-- Post-Stage-3 corrective fix, found via a real live Playwright run
-- (e2e/moderation.spec.ts's "editorial history panel appears on the
-- editor's edit page" test): get_story_editorial_history()
-- (supabase/migrations/20260805100900_moderator_story_detail_functions.sql)
-- was written moderator/admin-only, matching Stage 1's own review-page
-- use case ("moderators are allowed to see editorial prep history for
-- review purposes"). Stage 2 then wired the SAME function into
-- app/(editor)/editorial/editorial-history-panel.tsx, rendered on the
-- assigned EDITOR's own edit page -- so every editor visiting their own
-- story's edit page hit a genuine, live-reproducing 500
-- ("P0001: Only a moderator or admin can read editorial history"),
-- confirmed directly against the real server logs during this run.
--
-- Fixed by additionally authorizing the story's assigned editor (the
-- exact same relationship get_story_for_editor() already checks, and the
-- same coalesce(...,false) pattern this codebase's own nullable-actor
-- bug class requires -- assigned_editor_id is nullable, so an unwrapped
-- `= auth.uid()` comparison would silently skip the raise for any
-- self-service story, exactly the bug already fixed four times elsewhere
-- in this codebase). Moderator/admin access is unchanged.
--
-- CREATE OR REPLACE is sufficient: the signature (uuid) -> setof/table
-- shape is unchanged, only the body's authorization check changes.

create or replace function public.get_story_editorial_history(p_story_id uuid)
returns table (
  id uuid,
  revision_id uuid,
  editor_id uuid,
  action_type text,
  summary text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_assigned_editor_id uuid;
begin
  select s.assigned_editor_id into v_assigned_editor_id
  from public.stories s where s.id = p_story_id;
  if not found then raise exception 'No such story: %', p_story_id; end if;

  if not (
    coalesce(v_assigned_editor_id = auth.uid(), false)
    or public.has_role(auth.uid(), 'moderator')
    or public.has_role(auth.uid(), 'admin')
  ) then
    raise exception 'Not authorized to read editorial history for story %', p_story_id;
  end if;

  return query
    select a.id, a.revision_id, a.editor_id, a.action_type, a.summary, a.created_at
    from public.editorial_actions a
    where a.story_id = p_story_id
    order by a.created_at desc;
end;
$$;

comment on function public.get_story_editorial_history(uuid) is
  'Assigned editor (own story), moderator, or admin. Broadened from moderator/admin-only after a live Playwright run found every editor 500ing on their own edit page, which Stage 2 wired this same function into via editorial-history-panel.tsx.';

revoke execute on function public.get_story_editorial_history(uuid) from public, anon, authenticated;
grant execute on function public.get_story_editorial_history(uuid) to authenticated;
