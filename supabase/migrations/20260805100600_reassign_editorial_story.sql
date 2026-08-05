-- Prompt 6 Stage 1: editorial reassignment.
--
-- Scope judgment call: restricted to source_kind = 'editorial_import'
-- stories only. assigned_editor_id exists on every story, but it is only
-- ever populated (create_editorial_import_draft(), the assigned-editor
-- authorization checks throughout story_lifecycle_functions.sql) for
-- editorial imports -- a self-service story has no concept of a "prepared
-- by" editor to reassign. Grepped the whole story-domain migration set for
-- any self-service path that sets assigned_editor_id: none exists. Raising
-- explicitly for a non-editorial-import story is safer than silently
-- allowing a reassignment concept that means nothing there.
--
-- Authorization rule (narrowest sensible reading of "an editor may only act
-- within whatever scope existing editorial RLS/authorization already grants
-- editors over stories"):
--   - admin: may reassign ANY editorial_import story to any eligible editor.
--   - editor: may CLAIM an unassigned editorial_import story (current
--     assigned_editor_id is null) by reassigning it to themselves, OR hand
--     off a story currently assigned to THEM to a different eligible
--     editor. An editor may never reassign a story assigned to a different
--     editor -- that is an admin-only action, mirroring
--     mark_editorial_draft_awaiting_approval()'s existing
--     "assigned_editor_id = auth.uid() or admin" pattern rather than
--     inventing a new authorization shape.
--
-- The target p_editor_id is independently verified to actually hold
-- editor or admin role via has_role() -- never trusted from the caller,
-- consistent with Engineering Rule 2.

create function public.reassign_editorial_story(
  p_story_id uuid,
  p_editor_id uuid,
  p_note text default null,
  p_expected_version integer default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_story public.stories;
  v_is_admin boolean;
  v_summary text;
begin
  v_is_admin := public.has_role(auth.uid(), 'admin');
  if not (public.has_role(auth.uid(), 'editor') or v_is_admin) then
    raise exception 'Only an editor or admin can reassign an editorial story';
  end if;

  if not (public.has_role(p_editor_id, 'editor') or public.has_role(p_editor_id, 'admin')) then
    raise exception 'Target user % does not hold an editor or admin role', p_editor_id;
  end if;

  select * into v_story from public.stories where id = p_story_id for update;
  if not found then
    raise exception 'No such story: %', p_story_id;
  end if;
  if p_expected_version is null or v_story.version <> p_expected_version then
    raise exception 'Stale version for story % (expected %, got %)', p_story_id, v_story.version, p_expected_version;
  end if;
  if v_story.source_kind <> 'editorial_import' then
    raise exception 'Only editorial-import stories can be reassigned';
  end if;

  if not v_is_admin then
    if not (
      (v_story.assigned_editor_id is null and p_editor_id = auth.uid())
      or coalesce(v_story.assigned_editor_id = auth.uid(), false)
    ) then
      raise exception 'An editor may only claim an unassigned story for themselves or hand off their own assigned story';
    end if;
  end if;

  update public.stories
    set assigned_editor_id = p_editor_id, version = version + 1
    where id = p_story_id;

  v_summary := coalesce(nullif(trim(p_note), ''), 'Story reassigned to a different editor.');

  insert into public.editorial_actions (story_id, revision_id, editor_id, action_type, summary)
  values (p_story_id, v_story.current_draft_revision_id, auth.uid(), 'reassigned', v_summary);
end;
$$;

comment on function public.reassign_editorial_story(uuid, uuid, text, integer) is
  'Editor/admin only, editorial_import stories only. Admin may reassign any such story to any eligible editor; an editor may only claim an unassigned story for themselves or hand off a story currently assigned to them. Locks + version-checks the story before mutating; records an editorial_actions row (action_type = ''reassigned'').';

revoke execute on function public.reassign_editorial_story(uuid, uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.reassign_editorial_story(uuid, uuid, text, integer) to authenticated;
