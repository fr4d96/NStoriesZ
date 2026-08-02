-- Bug fix, found via the RLS integration suite (tests/integration/
-- story-rls.integration.test.ts — "another user cannot read or edit the
-- private draft" caught this directly: a signed-in stranger could overwrite
-- another contributor's draft).
--
-- Root cause: SQL three-valued logic. `assigned_editor_id` and
-- `contributors.linked_user_id` are both nullable. An expression like
-- `v_story.assigned_editor_id = auth.uid()` evaluates to NULL (not false)
-- when the column is NULL, and `false OR NULL` is also NULL, not false.
-- PL/pgSQL's `IF NULL THEN ... END IF` does NOT execute the branch (it only
-- executes on TRUE) — so `if not (owner_check or assigned_editor_id =
-- auth.uid()) then raise exception ... end if;` silently skipped the raise
-- whenever assigned_editor_id was NULL (i.e. every self-service story),
-- regardless of who was calling. `has_role()` and `_is_story_owner()` were
-- never affected — both are defined with `exists(...)`, which always
-- returns a real boolean, never NULL.
--
-- Fixed by wrapping every such comparison in `coalesce(..., false)`, in
-- every function that had the pattern. WHERE-clause uses of the same
-- comparison (list_assigned_editorial_stories, list_my_stories) were NOT
-- affected — SQL correctly treats NULL as "exclude this row" there, which
-- was already the intended behavior.

create or replace function public.mark_editorial_draft_awaiting_approval(p_story_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_story public.stories;
begin
  select * into v_story from public.stories where id = p_story_id for update;
  if not found then
    raise exception 'No such story: %', p_story_id;
  end if;
  if not coalesce(v_story.assigned_editor_id = auth.uid() or public.has_role(auth.uid(), 'admin'), false) then
    raise exception 'Only the assigned editor or an admin can mark a draft ready for contributor review';
  end if;
  if v_story.source_kind <> 'editorial_import' or v_story.lifecycle_status <> 'draft' then
    raise exception 'Story % is not an editorial draft awaiting readiness', p_story_id;
  end if;
  if v_story.current_draft_revision_id is null then
    raise exception 'Story % has no active draft revision', p_story_id;
  end if;

  update public.stories set lifecycle_status = 'awaiting_contributor_approval' where id = p_story_id;
end;
$$;

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
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_story_id uuid;
  v_story public.stories;
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

  update public.stories set version = version + 1 where id = v_story_id;
end;
$$;

create or replace function public.submit_revision_with_consent(
  p_revision_id uuid,
  p_expected_version integer,
  p_confirmation_method text,
  p_publication_confirmed boolean,
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
  v_terms_version constant text := 'whv-compass-terms-2026-08';
  v_revision public.story_revisions;
  v_story public.stories;
  v_contributor public.contributors;
  v_media_count integer;
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
  if v_revision.revision_status <> 'draft' or not public._revision_is_editable(p_revision_id) then
    raise exception 'Revision % is not in a submittable state', p_revision_id;
  end if;
  if p_publication_confirmed is not true then
    raise exception 'Publication permission must be explicitly confirmed';
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
  end if;

  if v_story.source_kind = 'editorial_import' and p_editorial_assistance_confirmed is not true then
    raise exception 'Editorial-assistance confirmation is required for editorial imports';
  end if;

  if p_confirmation_method = 'account' then
    if not coalesce(auth.uid() = v_contributor.linked_user_id, false) then
      raise exception 'Only the linked contributor can confirm consent by account';
    end if;
  elsif p_confirmation_method in ('email', 'written_message', 'in_person', 'other') then
    if v_story.source_kind <> 'editorial_import' then
      raise exception 'Offline confirmation methods are only valid for editorial imports';
    end if;
    if not coalesce(v_story.assigned_editor_id = auth.uid() or public.has_role(auth.uid(), 'admin'), false) then
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

create or replace function public.create_next_draft_revision(p_story_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_story public.stories;
  v_candidate record;
  v_published_number integer;
  v_source_revision_id uuid;
  v_new_revision_id uuid;
  v_next_number integer;
begin
  select * into v_story from public.stories where id = p_story_id for update;
  if not found then
    raise exception 'No such story: %', p_story_id;
  end if;
  if not coalesce(public._is_story_owner(p_story_id) or v_story.assigned_editor_id = auth.uid(), false) then
    raise exception 'Only the story owner or assigned editor can start a new draft revision';
  end if;
  if v_story.current_draft_revision_id is not null then
    raise exception 'Story % already has an active draft/replacement revision', p_story_id;
  end if;
  if v_story.lifecycle_status = 'archived' then
    raise exception 'Cannot create a new revision for an archived story';
  end if;

  select id, revision_number into v_candidate
  from public.story_revisions
  where story_id = p_story_id and revision_status in ('rejected', 'changes_requested', 'withdrawn')
  order by revision_number desc limit 1;

  if v_story.published_revision_id is null then
    if v_candidate.id is null then
      raise exception 'Story % has no prior terminal revision to base a new draft on', p_story_id;
    end if;
    v_source_revision_id := v_candidate.id;
  else
    select revision_number into v_published_number
    from public.story_revisions where id = v_story.published_revision_id;
    if v_candidate.id is not null and v_candidate.revision_number > v_published_number then
      v_source_revision_id := v_candidate.id;
    else
      v_source_revision_id := v_story.published_revision_id;
    end if;
  end if;

  select coalesce(max(revision_number), 0) + 1 into v_next_number
  from public.story_revisions where story_id = p_story_id;

  insert into public.story_revisions (
    story_id, revision_number, title, excerpt, content_json, trip_start_date, trip_end_date,
    trip_year, travel_style, total_expense_nzd_cents, contributor_note, created_by, updated_by
  )
  select
    p_story_id, v_next_number, title, excerpt, content_json, trip_start_date, trip_end_date,
    trip_year, travel_style, total_expense_nzd_cents, contributor_note, auth.uid(), auth.uid()
  from public.story_revisions where id = v_source_revision_id
  returning id into v_new_revision_id;

  insert into public.story_revision_locations (revision_id, region_id, destination_id, sort_order)
  select v_new_revision_id, region_id, destination_id, sort_order
  from public.story_revision_locations where revision_id = v_source_revision_id;

  insert into public.story_revision_work_types (revision_id, work_type_id)
  select v_new_revision_id, work_type_id
  from public.story_revision_work_types where revision_id = v_source_revision_id;

  insert into public.story_revision_tags (revision_id, tag_id)
  select v_new_revision_id, tag_id
  from public.story_revision_tags where revision_id = v_source_revision_id;

  insert into public.story_revision_media (revision_id, media_id, alt_text, caption, decorative, sort_order, is_cover)
  select v_new_revision_id, media_id, alt_text, caption, decorative, sort_order, is_cover
  from public.story_revision_media where revision_id = v_source_revision_id;

  update public.stories set current_draft_revision_id = v_new_revision_id, version = version + 1
    where id = p_story_id;

  if v_story.lifecycle_status in ('rejected', 'changes_requested', 'draft') then
    update public.stories set lifecycle_status = 'draft' where id = p_story_id;
  end if;

  return v_new_revision_id;
end;
$$;

create or replace function public.withdraw_unstarted_submission(p_story_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_story public.stories;
  v_revision public.story_revisions;
begin
  select * into v_story from public.stories where id = p_story_id for update;
  if not found then
    raise exception 'No such story: %', p_story_id;
  end if;
  if not coalesce(public._is_story_owner(p_story_id) or v_story.assigned_editor_id = auth.uid(), false) then
    raise exception 'Only the story owner or assigned editor can withdraw a submission';
  end if;
  if v_story.current_draft_revision_id is null then
    raise exception 'Story % has no active submission to withdraw', p_story_id;
  end if;

  select * into v_revision from public.story_revisions
    where id = v_story.current_draft_revision_id for update;
  if v_revision.revision_status <> 'submitted' then
    raise exception 'Revision % is not currently submitted', v_revision.id;
  end if;
  if exists (select 1 from public.moderation_actions where revision_id = v_revision.id) then
    raise exception 'Revision % has already been acted on by a moderator', v_revision.id;
  end if;

  update public.story_revisions set revision_status = 'withdrawn', updated_by = auth.uid()
    where id = v_revision.id;
  update public.stories set current_draft_revision_id = null, version = version + 1 where id = p_story_id;

  if v_story.published_revision_id is null then
    update public.stories set lifecycle_status = 'draft' where id = p_story_id;
  end if;
end;
$$;

create or replace function public.request_editorial_changes(p_story_id uuid, p_note text)
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
  if not coalesce(
    auth.uid() = (select linked_user_id from public.contributors where id = v_story.contributor_id),
    false
  ) then
    raise exception 'Only the linked contributor can request editorial changes';
  end if;
  if v_story.lifecycle_status <> 'awaiting_contributor_approval' then
    raise exception 'Story % is not awaiting contributor approval', p_story_id;
  end if;

  update public.story_revisions set revision_status = 'changes_requested', updated_by = auth.uid()
    where id = v_story.current_draft_revision_id;
  update public.stories
    set lifecycle_status = 'changes_requested', current_draft_revision_id = null, version = version + 1
    where id = p_story_id;

  insert into public.editorial_actions (story_id, revision_id, editor_id, action_type, summary)
  values (p_story_id, v_story.current_draft_revision_id, auth.uid(), 'contributor_requested_changes', p_note);
end;
$$;

create or replace function public.decline_editorial_publication(p_story_id uuid, p_note text)
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
  if not coalesce(
    auth.uid() = (select linked_user_id from public.contributors where id = v_story.contributor_id),
    false
  ) then
    raise exception 'Only the linked contributor can decline editorial publication';
  end if;
  if v_story.lifecycle_status <> 'awaiting_contributor_approval' then
    raise exception 'Story % is not awaiting contributor approval', p_story_id;
  end if;

  update public.story_revisions set revision_status = 'rejected', updated_by = auth.uid()
    where id = v_story.current_draft_revision_id;
  update public.stories
    set lifecycle_status = 'rejected', current_draft_revision_id = null, version = version + 1
    where id = p_story_id;

  insert into public.editorial_actions (story_id, revision_id, editor_id, action_type, summary)
  values (p_story_id, v_story.current_draft_revision_id, auth.uid(), 'contributor_declined', p_note);
end;
$$;

create or replace function public._authorize_revision_edit(p_revision_id uuid, out v_story_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_story public.stories;
begin
  select story_id into v_story_id from public.story_revisions where id = p_revision_id;
  if v_story_id is null then raise exception 'No such revision: %', p_revision_id; end if;
  select * into v_story from public.stories where id = v_story_id for update;
  if not coalesce(public._is_story_owner(v_story_id) or v_story.assigned_editor_id = auth.uid(), false) then
    raise exception 'Only the story owner or assigned editor can edit this revision';
  end if;
  if not public._revision_is_editable(p_revision_id) then
    raise exception 'Revision % is not currently editable', p_revision_id;
  end if;
end;
$$;

create or replace function public.get_story_for_editor(p_story_id uuid)
returns table (
  story_id uuid, slug text, lifecycle_status public.story_lifecycle_status, version integer,
  revision_id uuid, revision_number integer, revision_status public.story_revision_status,
  title text, editor_note text, editor_note_created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_story public.stories;
begin
  select * into v_story from public.stories where id = p_story_id;
  if not found then raise exception 'No such story: %', p_story_id; end if;
  if not coalesce(v_story.assigned_editor_id = auth.uid() or public.has_role(auth.uid(), 'admin'), false) then
    raise exception 'Not authorized to read story % as editor', p_story_id;
  end if;

  return query
    select v_story.id, v_story.slug, v_story.lifecycle_status, v_story.version,
           r.id, r.revision_number, r.revision_status, r.title, n.editor_note, n.created_at
    from public.story_revisions r
    left join public.story_revision_editor_notes n on n.revision_id = r.id
    where r.story_id = p_story_id
    order by r.revision_number desc, n.created_at desc;
end;
$$;

-- All EXECUTE grants are unchanged from the original migration (same exact
-- signatures) — CREATE OR REPLACE FUNCTION preserves existing grants, so no
-- revoke/grant statements are needed here.
