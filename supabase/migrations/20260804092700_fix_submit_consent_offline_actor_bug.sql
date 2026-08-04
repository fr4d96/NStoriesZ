-- Hardening, not a live-exploited bug like the previous two migrations, but
-- the same bug class caught while re-auditing every function this sub-phase
-- touches after the save_revision_draft regression: the offline-
-- confirmation-method branch inside submit_revision_with_consent() (added
-- in 20260803090700, re-created as-is by 20260804092100's DROP+CREATE for
-- the terms-version work) checks:
--
--   if not (v_story.assigned_editor_id = auth.uid() or public.has_role(auth.uid(), 'admin')) then
--
-- Same unwrapped-nullable-actor pattern: if assigned_editor_id were ever
-- null for a story reaching this branch, `null = auth.uid()` is NULL, and
-- `NOT (NULL OR false)` is NULL, which PL/pgSQL's `if` treats as false --
-- silently skipping the raise. In practice this branch is only reachable for
-- source_kind = 'editorial_import' (checked immediately above it), and
-- create_editorial_import_draft() always sets assigned_editor_id to a real,
-- non-null value (coalesce(p_assigned_editor_id, auth.uid())) -- so this has
-- not been observed to be exploitable today. Fixed anyway, on the same
-- coalesce(..., false) pattern already used everywhere else in this
-- function and across this codebase, rather than leave a known instance of
-- an already-twice-fixed bug class in a function this sub-phase is already
-- editing. No other change to this function.

create or replace function public.submit_revision_with_consent(
  p_revision_id uuid,
  p_expected_version integer,
  p_confirmation_method text,
  p_publication_confirmed boolean,
  p_expected_terms_version text,
  p_image_rights_confirmed boolean default false,
  p_identifiable_people_state public.identifiable_people_state default 'pending',
  p_editorial_assistance_confirmed boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_terms_version constant text := public.current_terms_version();
  v_revision public.story_revisions;
  v_story public.stories;
  v_contributor public.contributors;
  v_media_count integer;
  v_unprocessed_count integer;
  v_event_number integer;
begin
  select * into v_revision from public.story_revisions where id = p_revision_id for update;
  if not found then
    raise exception 'No such revision: %', p_revision_id;
  end if;

  select * into v_story from public.stories where id = v_revision.story_id for update;
  if v_story.version <> p_expected_version then
    raise exception 'Stale version for story % (expected %, got %)', v_story.id, v_story.version, p_expected_version;
  end if;
  if v_story.consent_revoked_at is not null then
    raise exception 'Consent has been revoked for story %; no further submissions are possible', v_story.id;
  end if;

  if v_revision.revision_status <> 'draft' then
    raise exception 'Revision % is not in a submittable state', p_revision_id;
  end if;
  if not (
    public._revision_is_editable(p_revision_id)
    or (
      v_story.lifecycle_status = 'awaiting_contributor_approval'
      and v_story.current_draft_revision_id = p_revision_id
    )
  ) then
    raise exception 'Revision % is not in a submittable state', p_revision_id;
  end if;

  if p_publication_confirmed is not true then
    raise exception 'Publication permission must be explicitly confirmed';
  end if;

  if p_expected_terms_version is distinct from v_terms_version then
    raise exception using
      errcode = 'WHV01',
      message = format(
        'Terms of service have changed since you last reviewed them (expected %s, current %s); please review and resubmit.',
        p_expected_terms_version, v_terms_version
      );
  end if;

  select * into v_contributor from public.contributors where id = v_story.contributor_id;
  if v_contributor.display_name is null or char_length(trim(v_contributor.display_name)) = 0 then
    raise exception 'Story % has no valid attribution to snapshot', v_story.id;
  end if;

  select count(*) into v_media_count
  from public.story_revision_media where revision_id = p_revision_id;
  if v_media_count > 0 then
    if p_image_rights_confirmed is not true
      or p_identifiable_people_state not in ('confirmed', 'not_applicable') then
      raise exception 'Image rights and identifiable-people state must be resolved before submission';
    end if;

    select count(*) into v_unprocessed_count
    from public.story_revision_media rm
    join public.story_media m on m.id = rm.media_id
    where rm.revision_id = p_revision_id
      and m.processing_state not in ('processed', 'promotion_pending', 'promoted');
    if v_unprocessed_count > 0 then
      raise exception
        'Revision % has % attached image(s) that have not finished processing yet', p_revision_id, v_unprocessed_count;
    end if;
  end if;

  if v_story.source_kind = 'editorial_import' and p_editorial_assistance_confirmed is not true then
    raise exception 'Editorial-assistance confirmation is required for editorial imports';
  end if;

  if p_confirmation_method = 'account' then
    if v_story.source_kind = 'self_submitted' then
      if auth.uid() <> v_story.owner_user_id then
        raise exception 'Only the story owner can confirm consent by account';
      end if;
    else
      if auth.uid() <> v_contributor.linked_user_id then
        raise exception 'Only the linked contributor can confirm consent by account';
      end if;
    end if;
  elsif p_confirmation_method in ('email', 'written_message', 'in_person', 'other') then
    if v_story.source_kind <> 'editorial_import' then
      raise exception 'Offline confirmation methods are only valid for editorial imports';
    end if;
    if not coalesce(v_story.assigned_editor_id = auth.uid(), false)
      and not public.has_role(auth.uid(), 'admin') then
      raise exception 'Only the assigned editor or an admin can record an offline confirmation';
    end if;
  else
    raise exception 'Unknown confirmation method: %', p_confirmation_method;
  end if;

  v_event_number := coalesce(
    (select max(event_number) from public.story_publication_consents where story_id = v_story.id), 0
  ) + 1;

  insert into public.story_publication_consents (
    story_id, revision_id, contributor_id, event_number, attribution_type, attribution_value,
    confirmation_method, publication_confirmed_at, image_rights_confirmed_at,
    identifiable_people_state, editorial_assistance_confirmed_at, terms_version, recorded_by
  )
  values (
    v_story.id, p_revision_id, v_story.contributor_id, v_event_number, v_contributor.attribution_type,
    v_contributor.display_name, p_confirmation_method, now(),
    case when p_image_rights_confirmed then now() else null end,
    p_identifiable_people_state,
    case when p_editorial_assistance_confirmed then now() else null end,
    v_terms_version, auth.uid()
  );

  update public.story_revisions set revision_status = 'submitted', updated_by = auth.uid()
    where id = p_revision_id;

  if v_story.published_revision_id is null then
    update public.stories set lifecycle_status = 'pending_review', submitted_at = now(), version = version + 1
      where id = v_story.id;
  else
    update public.stories set submitted_at = now(), version = version + 1 where id = v_story.id;
  end if;
end;
$$;

comment on function public.submit_revision_with_consent(
  uuid, integer, text, boolean, text, boolean, public.identifiable_people_state, boolean
) is
  'Requires p_expected_terms_version (raises WHV01 on mismatch), source-kind-partitions the account-confirmation check, allows submission while awaiting this contributor''s approval, and (20260804092700) wraps the offline-confirmation assigned-editor check in coalesce(...,false) against the same nullable-actor bug class fixed elsewhere.';

revoke execute on function public.submit_revision_with_consent(
  uuid, integer, text, boolean, text, boolean, public.identifiable_people_state, boolean
) from public, anon, authenticated;
grant execute on function public.submit_revision_with_consent(
  uuid, integer, text, boolean, text, boolean, public.identifiable_people_state, boolean
) to authenticated;
