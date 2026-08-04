-- Prompt 4: finalize_story_publication() is the single atomic publication
-- transaction. It runs through the moderator's own regular (RLS-respecting,
-- role-re-deriving) client — never the admin client — because the approval
-- decision is the moderator's privileged act and must be attributable to
-- their real identity, same as every other Prompt 3 lifecycle function. It
-- assumes the mechanical, admin-client-driven copy work
-- (begin_story_media_copy_attempt / record_story_media_copy_verified) has
-- already completed for every not-already-promoted media item on the
-- revision.
--
-- moderate_revision() (Prompt 3) is narrowed here to reject/changes_requested
-- only — 'approve' now raises, directing callers to
-- begin_story_publication_attempt() + finalize_story_publication() instead.
-- Both this function and the narrowed moderate_revision() lock the
-- story_publication_attempts row and re-check status = 'active' before
-- proceeding, so a race between "finalize this attempt" and "reject this
-- revision instead" resolves to whichever reaches the lock first, with the
-- other getting a clear "already resolved" error rather than a silent
-- conflicting outcome.

create or replace function public.finalize_story_publication(
  p_revision_id uuid,
  p_approval_attempt_id uuid,
  p_user_facing_reason text default null,
  p_editor_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.story_publication_attempts;
  v_revision public.story_revisions;
  v_story public.stories;
  v_old_published_revision_id uuid;
  v_rm record;
  v_copy public.story_media_public_copy_attempts;
  v_action_id uuid;
begin
  select * into v_attempt from public.story_publication_attempts
    where id = p_approval_attempt_id for update;
  if not found then
    raise exception 'No such publication attempt: %', p_approval_attempt_id;
  end if;
  if v_attempt.revision_id <> p_revision_id then
    raise exception 'Publication attempt % does not belong to revision %', p_approval_attempt_id, p_revision_id;
  end if;
  if not (v_attempt.initiated_by = auth.uid() or public.has_role(auth.uid(), 'admin')) then
    raise exception 'Only the initiating moderator or an admin may finalize this publication attempt';
  end if;
  if v_attempt.status = 'finalized' then
    -- Idempotent retry of an already-completed finalize: safe no-op.
    return;
  end if;
  if v_attempt.status <> 'active' then
    raise exception 'Publication attempt % has already been resolved (%)', p_approval_attempt_id, v_attempt.status;
  end if;

  select * into v_revision from public.story_revisions where id = p_revision_id for update;
  if not found then raise exception 'No such revision: %', p_revision_id; end if;
  if v_revision.revision_status <> 'submitted' then
    raise exception 'Revision % is not currently submitted', p_revision_id;
  end if;
  select * into v_story from public.stories where id = v_revision.story_id for update;

  if public._latest_valid_consent_for_revision(v_story.id, p_revision_id) is null then
    raise exception 'Revision % has no currently-valid consent grant', p_revision_id;
  end if;

  v_old_published_revision_id := v_story.published_revision_id;

  for v_rm in
    select rm.media_id, m.processing_state
    from public.story_revision_media rm
    join public.story_media m on m.id = rm.media_id
    where rm.revision_id = p_revision_id
  loop
    if v_rm.processing_state = 'promoted' then
      continue; -- reused, unchanged media from a prior publication
    end if;
    if v_rm.processing_state <> 'promotion_pending' then
      raise exception 'Media % is not ready for publication (state %)', v_rm.media_id, v_rm.processing_state;
    end if;

    select * into v_copy from public.story_media_public_copy_attempts
      where media_id = v_rm.media_id and approval_attempt_id = p_approval_attempt_id;
    if not found or v_copy.status <> 'verified' then
      raise exception 'Media % has no verified copy for this publication attempt', v_rm.media_id;
    end if;

    update public.story_media
      set approved_public_storage_path = v_copy.public_path, processing_state = 'promoted'
      where id = v_rm.media_id;

    update public.story_media_public_copy_attempts
      set resolved_at = now(), resolution = 'promoted'
      where id = v_copy.id;
  end loop;

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

  insert into public.moderation_actions (
    story_id, revision_id, moderator_id, previous_status, new_status, user_facing_reason
  )
  values (v_story.id, p_revision_id, auth.uid(), 'submitted', 'approved', p_user_facing_reason)
  returning id into v_action_id;

  if p_editor_note is not null and char_length(p_editor_note) > 0 then
    insert into public.moderation_action_notes (action_id, internal_note, created_by)
    values (v_action_id, p_editor_note, auth.uid());
  end if;

  update public.story_publication_attempts
    set status = 'finalized', resolved_at = now(), updated_at = now()
    where id = p_approval_attempt_id;
end;
$$;

comment on function public.finalize_story_publication(uuid, uuid, text, text) is
  'The single atomic publication transaction. Accepts each attached media item either already promoted (reused unchanged from a prior publication) or promotion_pending with a verified copy for this exact attempt — only the latter transitions to promoted here. No expectedVersion parameter: submitted revisions are already immutable, so the attempt''s own active/finalized/abandoned state plus row locks are the concurrency boundary, not the authoring version. Idempotent: retrying an already-finalized attempt is a safe no-op.';

revoke execute on function public.finalize_story_publication(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.finalize_story_publication(uuid, uuid, text, text) to authenticated;

-- Narrow moderate_revision() to reject/changes_requested only. 'approve'
-- now raises, directing callers to the attempt-based flow — this is what
-- makes the publication-attempt system the ONLY path to approval, not an
-- optional one a caller could bypass by still calling the old function.
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
  v_action_id uuid;
  v_attempt public.story_publication_attempts;
begin
  if not (public.has_role(auth.uid(), 'moderator') or public.has_role(auth.uid(), 'admin')) then
    raise exception 'Only a moderator or admin can moderate a revision';
  end if;
  if p_decision = 'approve' then
    raise exception 'Approval now goes through begin_story_publication_attempt() and finalize_story_publication(), not moderate_revision()';
  end if;
  if p_decision not in ('reject', 'changes_requested') then
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

  -- If a publication attempt is mid-flight for this revision, this decision
  -- abandons it — but only the attempt's own initiator or an admin may do
  -- so (same ownership rule finalize_story_publication enforces), and the
  -- lock here is what makes a race against a concurrent finalize resolve to
  -- exactly one winner.
  select * into v_attempt from public.story_publication_attempts
    where revision_id = p_revision_id and status = 'active' for update;
  if found then
    if not (v_attempt.initiated_by = auth.uid() or public.has_role(auth.uid(), 'admin')) then
      raise exception 'Only the initiating moderator or an admin may act on this publication attempt';
    end if;

    update public.story_media_public_copy_attempts
      set resolved_at = now(), resolution = 'abandoned'
      where approval_attempt_id = v_attempt.id and resolved_at is null;

    update public.story_media
      set processing_state = 'processed'
      where processing_state = 'promotion_pending'
        and id in (
          select media_id from public.story_media_public_copy_attempts
          where approval_attempt_id = v_attempt.id
        );

    update public.story_publication_attempts
      set status = 'abandoned', resolved_at = now(), updated_at = now()
      where id = v_attempt.id;
  end if;

  if p_decision = 'reject' then
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

revoke execute on function public.moderate_revision(uuid, integer, text, text, text)
  from public, anon, authenticated;
grant execute on function public.moderate_revision(uuid, integer, text, text, text) to authenticated;
