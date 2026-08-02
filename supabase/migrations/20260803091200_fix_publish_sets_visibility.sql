-- Bug fix, found via the RLS integration suite: moderate_revision()'s
-- approve path set stories.lifecycle_status = 'published' but never touched
-- stories.visibility, which defaults to 'private' and had no other writer
-- anywhere in the system. Every public-read function correctly requires
-- BOTH visibility = 'public' AND lifecycle_status = 'published' (see
-- docs/architecture.md's public-RPC invariant checklist), so no story could
-- ever actually appear publicly, even once approved. Fixed by setting
-- visibility = 'public' at the same moment lifecycle_status becomes
-- 'published' (first publication only — a story already public stays
-- public through a replacement's approval).

create or replace function public.moderate_revision(
  p_revision_id uuid,
  p_expected_version integer,
  p_decision text,
  p_user_facing_reason text default null,
  p_editor_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revision public.story_revisions;
  v_story public.stories;
  v_is_first_publication boolean;
  v_old_published_revision_id uuid;
  v_action_id uuid;
begin
  if not (public.has_role(auth.uid(), 'moderator') or public.has_role(auth.uid(), 'admin')) then
    raise exception 'Only a moderator or admin can moderate a revision';
  end if;
  if p_decision not in ('approve', 'reject', 'changes_requested') then
    raise exception 'Unknown decision: %', p_decision;
  end if;

  select * into v_revision from public.story_revisions where id = p_revision_id for update;
  if not found then raise exception 'No such revision: %', p_revision_id; end if;
  select * into v_story from public.stories where id = v_revision.story_id for update;
  if v_story.version <> p_expected_version then
    raise exception 'Stale version for story % (expected %, got %)', v_story.id, v_story.version, p_expected_version;
  end if;
  if v_revision.revision_status <> 'submitted' then
    raise exception 'Revision % is not currently submitted', p_revision_id;
  end if;

  v_is_first_publication := v_story.published_revision_id is null;
  v_old_published_revision_id := v_story.published_revision_id;

  if p_decision = 'approve' then
    if public._latest_valid_consent_for_revision(v_story.id, p_revision_id) is null then
      raise exception 'Revision % has no currently-valid consent grant', p_revision_id;
    end if;
    perform public._require_processed_media(p_revision_id);

    update public.story_revisions
      set revision_status = 'approved', approved_at = now(), updated_by = auth.uid()
      where id = p_revision_id;

    if v_old_published_revision_id is not null then
      update public.story_revisions set revision_status = 'superseded', updated_by = auth.uid()
        where id = v_old_published_revision_id;
    end if;

    update public.stories
      set published_revision_id = p_revision_id,
          current_draft_revision_id = null,
          lifecycle_status = 'published',
          visibility = 'public',
          published_at = coalesce(published_at, now()),
          version = version + 1
      where id = v_story.id;
  elsif p_decision = 'reject' then
    update public.story_revisions set revision_status = 'rejected', updated_by = auth.uid()
      where id = p_revision_id;
    update public.stories
      set current_draft_revision_id = null,
          lifecycle_status = case when v_is_first_publication then 'rejected'::public.story_lifecycle_status
                                   else lifecycle_status end,
          version = version + 1
      where id = v_story.id;
  else -- changes_requested
    update public.story_revisions set revision_status = 'changes_requested', updated_by = auth.uid()
      where id = p_revision_id;
    update public.stories
      set current_draft_revision_id = null,
          lifecycle_status = case when v_is_first_publication then 'changes_requested'::public.story_lifecycle_status
                                   else lifecycle_status end,
          version = version + 1
      where id = v_story.id;
  end if;

  insert into public.moderation_actions (
    story_id, revision_id, moderator_id, previous_status, new_status, user_facing_reason
  )
  values (
    v_story.id, p_revision_id, auth.uid(), 'submitted',
    case p_decision
      when 'approve' then 'approved'::public.story_revision_status
      when 'reject' then 'rejected'::public.story_revision_status
      else 'changes_requested'::public.story_revision_status
    end,
    p_user_facing_reason
  )
  returning id into v_action_id;

  if p_editor_note is not null and char_length(p_editor_note) > 0 then
    insert into public.moderation_action_notes (action_id, internal_note, created_by)
    values (v_action_id, p_editor_note, auth.uid());
  end if;
end;
$$;
