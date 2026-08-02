-- All SECURITY DEFINER functions that create, edit, submit, moderate, and
-- audit stories. This is the entire write surface (and most of the
-- authenticated read surface) for the story domain — no table grants exist,
-- per docs/architecture.md's "Story domain access model". Every function
-- follows the same template: re-derive caller identity/role from the
-- database, lock the row(s) being mutated, check current state, write,
-- schema-qualified, then `revoke execute ... from public, anon,
-- authenticated; grant execute ... to authenticated` (internal helpers get
-- the revoke with no grant at all).

-- Curated composite type returned by current_consent_state() — never the
-- base table's row type, so recorded_by/internal columns can never leak
-- through this function even by accident.
create type public.consent_state as (
  consent_status text,
  revision_id uuid,
  event_number integer,
  publication_confirmed_at timestamptz,
  attribution_type public.attribution_type,
  attribution_value text
);

-- ---------------------------------------------------------------------
-- Internal: slug generation
-- ---------------------------------------------------------------------
create or replace function public._generate_story_slug(p_title text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base text;
begin
  v_base := lower(regexp_replace(trim(p_title), '[^a-zA-Z0-9]+', '-', 'g'));
  v_base := trim(both '-' from v_base);
  if v_base = '' or v_base is null then
    v_base := 'story';
  end if;
  v_base := left(v_base, 60);
  return v_base || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
end;
$$;

revoke execute on function public._generate_story_slug(text) from public, anon, authenticated;

-- Internal: clears current_draft_revision_id and freezes whatever it
-- pointed at (draft/submitted -> withdrawn). Shared by archive_story() and
-- revoke_publication_consent() so they can't drift apart.
create or replace function public._terminalize_active_revision(p_story_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revision_id uuid;
  v_status public.story_revision_status;
begin
  select current_draft_revision_id into v_revision_id from public.stories where id = p_story_id;
  if v_revision_id is not null then
    select revision_status into v_status from public.story_revisions where id = v_revision_id;
    if v_status in ('draft', 'submitted') then
      update public.story_revisions
        set revision_status = 'withdrawn', updated_by = auth.uid()
        where id = v_revision_id;
    end if;
    update public.stories set current_draft_revision_id = null where id = p_story_id;
  end if;
end;
$$;

revoke execute on function public._terminalize_active_revision(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Author / submit
-- ---------------------------------------------------------------------

create or replace function public.create_self_service_draft(
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
returns table (story_id uuid, revision_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contributor_id uuid;
  v_story_id uuid;
  v_revision_id uuid;
begin
  select id into v_contributor_id from public.contributors where linked_user_id = auth.uid();
  if v_contributor_id is null then
    raise exception 'You must set up your contributor identity before creating a story';
  end if;

  insert into public.stories (contributor_id, owner_user_id, source_kind, slug, created_by)
  values (v_contributor_id, auth.uid(), 'self_submitted', public._generate_story_slug(p_title), auth.uid())
  returning id into v_story_id;

  insert into public.story_revisions (
    story_id, revision_number, title, excerpt, content_json, trip_start_date, trip_end_date,
    trip_year, travel_style, total_expense_nzd_cents, contributor_note, created_by, updated_by
  )
  values (
    v_story_id, 1, p_title, p_excerpt, coalesce(p_content_json, '[]'::jsonb), p_trip_start_date,
    p_trip_end_date, p_trip_year, p_travel_style, p_total_expense_nzd_cents, p_contributor_note,
    auth.uid(), auth.uid()
  )
  returning id into v_revision_id;

  update public.stories set current_draft_revision_id = v_revision_id where id = v_story_id;

  return query select v_story_id, v_revision_id;
end;
$$;

revoke execute on function public.create_self_service_draft(
  text, text, jsonb, date, date, smallint, text, integer, text
) from public, anon, authenticated;
grant execute on function public.create_self_service_draft(
  text, text, jsonb, date, date, smallint, text, integer, text
) to authenticated;

create or replace function public.create_editorial_import_draft(
  p_contributor_id uuid,
  p_title text,
  p_excerpt text default null,
  p_content_json jsonb default '[]'::jsonb,
  p_trip_start_date date default null,
  p_trip_end_date date default null,
  p_trip_year smallint default null,
  p_travel_style text default null,
  p_total_expense_nzd_cents integer default null,
  p_contributor_note text default null,
  p_assigned_editor_id uuid default null
)
returns table (story_id uuid, revision_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_user_id uuid;
  v_story_id uuid;
  v_revision_id uuid;
begin
  if not (public.has_role(auth.uid(), 'editor') or public.has_role(auth.uid(), 'admin')) then
    raise exception 'Only an editor or admin can create an editorial import';
  end if;

  select linked_user_id into v_owner_user_id
  from public.contributors where id = p_contributor_id;
  if not found then
    raise exception 'No such contributor: %', p_contributor_id;
  end if;

  insert into public.stories (
    contributor_id, owner_user_id, source_kind, slug, assigned_editor_id, created_by
  )
  values (
    p_contributor_id, v_owner_user_id, 'editorial_import', public._generate_story_slug(p_title),
    coalesce(p_assigned_editor_id, auth.uid()), auth.uid()
  )
  returning id into v_story_id;

  insert into public.story_revisions (
    story_id, revision_number, title, excerpt, content_json, trip_start_date, trip_end_date,
    trip_year, travel_style, total_expense_nzd_cents, contributor_note, created_by, updated_by
  )
  values (
    v_story_id, 1, p_title, p_excerpt, coalesce(p_content_json, '[]'::jsonb), p_trip_start_date,
    p_trip_end_date, p_trip_year, p_travel_style, p_total_expense_nzd_cents, p_contributor_note,
    auth.uid(), auth.uid()
  )
  returning id into v_revision_id;

  update public.stories set current_draft_revision_id = v_revision_id where id = v_story_id;

  return query select v_story_id, v_revision_id;
end;
$$;

revoke execute on function public.create_editorial_import_draft(
  uuid, text, text, jsonb, date, date, smallint, text, integer, text, uuid
) from public, anon, authenticated;
grant execute on function public.create_editorial_import_draft(
  uuid, text, text, jsonb, date, date, smallint, text, integer, text, uuid
) to authenticated;

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
  if not (v_story.assigned_editor_id = auth.uid() or public.has_role(auth.uid(), 'admin')) then
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

revoke execute on function public.mark_editorial_draft_awaiting_approval(uuid)
  from public, anon, authenticated;
grant execute on function public.mark_editorial_draft_awaiting_approval(uuid) to authenticated;

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

  update public.stories set version = version + 1 where id = v_story_id;
end;
$$;

revoke execute on function public.save_revision_draft(
  uuid, integer, text, text, jsonb, date, date, smallint, text, integer, text
) from public, anon, authenticated;
grant execute on function public.save_revision_draft(
  uuid, integer, text, text, jsonb, date, date, smallint, text, integer, text
) to authenticated;

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
    if auth.uid() <> v_contributor.linked_user_id then
      raise exception 'Only the linked contributor can confirm consent by account';
    end if;
  elsif p_confirmation_method in ('email', 'written_message', 'in_person', 'other') then
    if v_story.source_kind <> 'editorial_import' then
      raise exception 'Offline confirmation methods are only valid for editorial imports';
    end if;
    if not (v_story.assigned_editor_id = auth.uid() or public.has_role(auth.uid(), 'admin')) then
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

revoke execute on function public.submit_revision_with_consent(
  uuid, integer, text, boolean, boolean, public.identifiable_people_state, boolean
) from public, anon, authenticated;
grant execute on function public.submit_revision_with_consent(
  uuid, integer, text, boolean, boolean, public.identifiable_people_state, boolean
) to authenticated;

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
  if not (public._is_story_owner(p_story_id) or v_story.assigned_editor_id = auth.uid()) then
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

revoke execute on function public.create_next_draft_revision(uuid) from public, anon, authenticated;
grant execute on function public.create_next_draft_revision(uuid) to authenticated;

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
  if not (public._is_story_owner(p_story_id) or v_story.assigned_editor_id = auth.uid()) then
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

revoke execute on function public.withdraw_unstarted_submission(uuid) from public, anon, authenticated;
grant execute on function public.withdraw_unstarted_submission(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Contributor review decisions (editor-assisted import only)
-- ---------------------------------------------------------------------

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
  if auth.uid() <> (select linked_user_id from public.contributors where id = v_story.contributor_id) then
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

revoke execute on function public.request_editorial_changes(uuid, text) from public, anon, authenticated;
grant execute on function public.request_editorial_changes(uuid, text) to authenticated;

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
  if auth.uid() <> (select linked_user_id from public.contributors where id = v_story.contributor_id) then
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

revoke execute on function public.decline_editorial_publication(uuid, text) from public, anon, authenticated;
grant execute on function public.decline_editorial_publication(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- Moderation
-- ---------------------------------------------------------------------

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

revoke execute on function public.moderate_revision(uuid, integer, text, text, text)
  from public, anon, authenticated;
grant execute on function public.moderate_revision(uuid, integer, text, text, text) to authenticated;

create or replace function public.archive_story(p_story_id uuid, p_expected_version integer)
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
  select * into v_story from public.stories where id = p_story_id for update;
  if not found then raise exception 'No such story: %', p_story_id; end if;
  if v_story.version <> p_expected_version then
    raise exception 'Stale version for story % (expected %, got %)', p_story_id, v_story.version, p_expected_version;
  end if;

  perform public._terminalize_active_revision(p_story_id);

  update public.stories
    set lifecycle_status = 'archived', archived_at = now(), version = version + 1
    where id = p_story_id;
end;
$$;

revoke execute on function public.archive_story(uuid, integer) from public, anon, authenticated;
grant execute on function public.archive_story(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------
-- Relations / media
-- ---------------------------------------------------------------------

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
  if not (public._is_story_owner(v_story_id) or v_story.assigned_editor_id = auth.uid()) then
    raise exception 'Only the story owner or assigned editor can edit this revision';
  end if;
  if not public._revision_is_editable(p_revision_id) then
    raise exception 'Revision % is not currently editable', p_revision_id;
  end if;
end;
$$;

revoke execute on function public._authorize_revision_edit(uuid) from public, anon, authenticated;

create or replace function public.set_revision_locations(
  p_revision_id uuid, p_expected_version integer, p_locations jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_story_id uuid;
  v_version integer;
begin
  select public._authorize_revision_edit(p_revision_id) into v_story_id;
  select version into v_version from public.stories where id = v_story_id;
  if v_version <> p_expected_version then
    raise exception 'Stale version for story % (expected %, got %)', v_story_id, v_version, p_expected_version;
  end if;

  delete from public.story_revision_locations where revision_id = p_revision_id;
  insert into public.story_revision_locations (revision_id, region_id, destination_id, sort_order)
  select p_revision_id, (rec ->> 'region_id')::uuid, nullif(rec ->> 'destination_id', '')::uuid,
         coalesce((rec ->> 'sort_order')::int, 0)
  from jsonb_array_elements(coalesce(p_locations, '[]'::jsonb)) as rec;

  update public.stories set version = version + 1 where id = v_story_id;
end;
$$;

revoke execute on function public.set_revision_locations(uuid, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.set_revision_locations(uuid, integer, jsonb) to authenticated;

create or replace function public.set_revision_work_types(
  p_revision_id uuid, p_expected_version integer, p_work_type_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_story_id uuid;
  v_version integer;
begin
  select public._authorize_revision_edit(p_revision_id) into v_story_id;
  select version into v_version from public.stories where id = v_story_id;
  if v_version <> p_expected_version then
    raise exception 'Stale version for story % (expected %, got %)', v_story_id, v_version, p_expected_version;
  end if;

  delete from public.story_revision_work_types where revision_id = p_revision_id;
  insert into public.story_revision_work_types (revision_id, work_type_id)
  select p_revision_id, unnest(coalesce(p_work_type_ids, array[]::uuid[]));

  update public.stories set version = version + 1 where id = v_story_id;
end;
$$;

revoke execute on function public.set_revision_work_types(uuid, integer, uuid[])
  from public, anon, authenticated;
grant execute on function public.set_revision_work_types(uuid, integer, uuid[]) to authenticated;

create or replace function public.set_revision_tags(
  p_revision_id uuid, p_expected_version integer, p_tag_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_story_id uuid;
  v_version integer;
begin
  select public._authorize_revision_edit(p_revision_id) into v_story_id;
  select version into v_version from public.stories where id = v_story_id;
  if v_version <> p_expected_version then
    raise exception 'Stale version for story % (expected %, got %)', v_story_id, v_version, p_expected_version;
  end if;

  delete from public.story_revision_tags where revision_id = p_revision_id;
  insert into public.story_revision_tags (revision_id, tag_id)
  select p_revision_id, unnest(coalesce(p_tag_ids, array[]::uuid[]));

  update public.stories set version = version + 1 where id = v_story_id;
end;
$$;

revoke execute on function public.set_revision_tags(uuid, integer, uuid[])
  from public, anon, authenticated;
grant execute on function public.set_revision_tags(uuid, integer, uuid[]) to authenticated;

create or replace function public.attach_story_media(
  p_revision_id uuid,
  p_expected_version integer,
  p_private_storage_path text,
  p_source_mime_type text,
  p_width integer default null,
  p_height integer default null,
  p_source_file_size_bytes bigint default null,
  p_alt_text text default null,
  p_caption text default null,
  p_decorative boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_story_id uuid;
  v_story public.stories;
  v_media_id uuid;
  v_next_sort integer;
begin
  select public._authorize_revision_edit(p_revision_id) into v_story_id;
  select * into v_story from public.stories where id = v_story_id;
  if v_story.version <> p_expected_version then
    raise exception 'Stale version for story % (expected %, got %)', v_story_id, v_story.version, p_expected_version;
  end if;

  insert into public.story_media (
    story_id, owner_user_id, uploaded_by, private_storage_path, source_mime_type,
    width, height, source_file_size_bytes
  )
  values (
    v_story_id,
    case when v_story.source_kind = 'self_submitted' then auth.uid() else null end,
    auth.uid(), p_private_storage_path, p_source_mime_type, p_width, p_height, p_source_file_size_bytes
  )
  returning id into v_media_id;

  select coalesce(max(sort_order), -1) + 1 into v_next_sort
  from public.story_revision_media where revision_id = p_revision_id;

  insert into public.story_revision_media (
    revision_id, media_id, alt_text, caption, decorative, sort_order
  )
  values (p_revision_id, v_media_id, p_alt_text, p_caption, coalesce(p_decorative, false), v_next_sort);

  update public.stories set version = version + 1 where id = v_story_id;

  return v_media_id;
end;
$$;

revoke execute on function public.attach_story_media(
  uuid, integer, text, text, integer, integer, bigint, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.attach_story_media(
  uuid, integer, text, text, integer, integer, bigint, text, text, boolean
) to authenticated;

create or replace function public.update_story_media_caption(
  p_revision_id uuid, p_media_id uuid, p_expected_version integer,
  p_alt_text text, p_caption text, p_decorative boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_story_id uuid;
  v_version integer;
begin
  select public._authorize_revision_edit(p_revision_id) into v_story_id;
  select version into v_version from public.stories where id = v_story_id;
  if v_version <> p_expected_version then
    raise exception 'Stale version for story % (expected %, got %)', v_story_id, v_version, p_expected_version;
  end if;

  update public.story_revision_media
    set alt_text = p_alt_text, caption = p_caption, decorative = coalesce(p_decorative, false)
    where revision_id = p_revision_id and media_id = p_media_id;
  if not found then
    raise exception 'Media % is not attached to revision %', p_media_id, p_revision_id;
  end if;

  update public.stories set version = version + 1 where id = v_story_id;
end;
$$;

revoke execute on function public.update_story_media_caption(uuid, uuid, integer, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.update_story_media_caption(uuid, uuid, integer, text, text, boolean)
  to authenticated;

create or replace function public.reorder_story_media(
  p_revision_id uuid, p_expected_version integer, p_media_order uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_story_id uuid;
  v_version integer;
  v_media_id uuid;
  v_idx integer := 0;
begin
  select public._authorize_revision_edit(p_revision_id) into v_story_id;
  select version into v_version from public.stories where id = v_story_id;
  if v_version <> p_expected_version then
    raise exception 'Stale version for story % (expected %, got %)', v_story_id, v_version, p_expected_version;
  end if;

  -- Shift into a temporary unique range first to avoid colliding with the
  -- unique (revision_id, sort_order) constraint mid-update.
  update public.story_revision_media set sort_order = sort_order + 100000 where revision_id = p_revision_id;

  foreach v_media_id in array coalesce(p_media_order, array[]::uuid[])
  loop
    update public.story_revision_media set sort_order = v_idx
      where revision_id = p_revision_id and media_id = v_media_id;
    v_idx := v_idx + 1;
  end loop;

  update public.stories set version = version + 1 where id = v_story_id;
end;
$$;

revoke execute on function public.reorder_story_media(uuid, integer, uuid[])
  from public, anon, authenticated;
grant execute on function public.reorder_story_media(uuid, integer, uuid[]) to authenticated;

create or replace function public.set_story_cover_media(
  p_revision_id uuid, p_expected_version integer, p_media_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_story_id uuid;
  v_version integer;
begin
  select public._authorize_revision_edit(p_revision_id) into v_story_id;
  select version into v_version from public.stories where id = v_story_id;
  if v_version <> p_expected_version then
    raise exception 'Stale version for story % (expected %, got %)', v_story_id, v_version, p_expected_version;
  end if;

  update public.story_revision_media set is_cover = false where revision_id = p_revision_id;
  update public.story_revision_media set is_cover = true
    where revision_id = p_revision_id and media_id = p_media_id;
  if not found then
    raise exception 'Media % is not attached to revision %', p_media_id, p_revision_id;
  end if;

  update public.stories set version = version + 1 where id = v_story_id;
end;
$$;

revoke execute on function public.set_story_cover_media(uuid, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.set_story_cover_media(uuid, integer, uuid) to authenticated;

create or replace function public.detach_story_media(
  p_revision_id uuid, p_expected_version integer, p_media_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_story_id uuid;
  v_version integer;
begin
  select public._authorize_revision_edit(p_revision_id) into v_story_id;
  select version into v_version from public.stories where id = v_story_id;
  if v_version <> p_expected_version then
    raise exception 'Stale version for story % (expected %, got %)', v_story_id, v_version, p_expected_version;
  end if;

  delete from public.story_revision_media where revision_id = p_revision_id and media_id = p_media_id;

  update public.stories set version = version + 1 where id = v_story_id;
end;
$$;

revoke execute on function public.detach_story_media(uuid, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.detach_story_media(uuid, integer, uuid) to authenticated;

-- promote_story_media: created now, granted to no one in this phase. See
-- docs/architecture.md — Prompt 4 must deliberately decide and grant the
-- trusted image-processing pipeline's exact access. service_role does NOT
-- automatically bypass function EXECUTE privilege, so leaving this ungranted
-- genuinely makes it unreachable, not reachable-by-assumption.
create or replace function public.promote_story_media(
  p_media_id uuid,
  p_approved_public_storage_path text,
  p_processed_mime_type text,
  p_processed_file_size_bytes bigint,
  p_width integer,
  p_height integer,
  p_sha256 text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.story_media
  set approved_public_storage_path = p_approved_public_storage_path,
      processed_mime_type = p_processed_mime_type,
      processed_file_size_bytes = p_processed_file_size_bytes,
      width = p_width,
      height = p_height,
      sha256 = p_sha256,
      metadata_removed_at = now()
  where id = p_media_id;
  if not found then
    raise exception 'No such media: %', p_media_id;
  end if;
end;
$$;

comment on function public.promote_story_media(uuid, text, text, bigint, integer, integer, text) is
  'Sets processed/approved image fields. Deliberately ungranted in Prompt 3 — no role can call this via the API. Prompt 4''s image-processing pipeline must establish its own trusted access explicitly.';

revoke execute on function public.promote_story_media(uuid, text, text, bigint, integer, integer, text)
  from public, anon, authenticated;
-- No grant statement, on purpose.

-- ---------------------------------------------------------------------
-- Consent
-- ---------------------------------------------------------------------

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
end;
$$;

revoke execute on function public.revoke_publication_consent(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.revoke_publication_consent(uuid, integer) to authenticated;

create or replace function public.current_consent_state(p_story_id uuid)
returns public.consent_state
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result public.consent_state;
  v_row public.story_publication_consents;
begin
  if not (
    public._is_story_owner(p_story_id)
    or public.has_role(auth.uid(), 'editor')
    or public.has_role(auth.uid(), 'moderator')
    or public.has_role(auth.uid(), 'admin')
  ) then
    raise exception 'Not authorized to read consent state for story %', p_story_id;
  end if;

  select c.* into v_row
  from public.story_publication_consents c
  where c.story_id = p_story_id
  order by c.event_number desc
  limit 1;

  if not found then
    return null;
  end if;

  v_result.consent_status := v_row.consent_status;
  v_result.revision_id := v_row.revision_id;
  v_result.event_number := v_row.event_number;
  v_result.publication_confirmed_at := v_row.publication_confirmed_at;
  v_result.attribution_type := v_row.attribution_type;
  v_result.attribution_value := v_row.attribution_value;
  return v_result;
end;
$$;

revoke execute on function public.current_consent_state(uuid) from public, anon, authenticated;
grant execute on function public.current_consent_state(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------

create or replace function public.create_story_report(
  p_story_id uuid, p_category text, p_details text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_story public.stories;
  v_report_id uuid;
begin
  select * into v_story from public.stories where id = p_story_id;
  if not found or v_story.visibility <> 'public' or v_story.lifecycle_status <> 'published'
     or v_story.published_revision_id is null then
    raise exception 'Story % is not currently published', p_story_id;
  end if;

  insert into public.story_reports (story_id, published_revision_id, reporter_id, category, details)
  values (p_story_id, v_story.published_revision_id, auth.uid(), p_category, p_details)
  returning id into v_report_id;

  return v_report_id;
end;
$$;

revoke execute on function public.create_story_report(uuid, text, text) from public, anon, authenticated;
grant execute on function public.create_story_report(uuid, text, text) to authenticated;

create or replace function public.list_my_reports()
returns setof public.story_reports
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.story_reports where reporter_id = auth.uid() order by created_at desc;
$$;

revoke execute on function public.list_my_reports() from public, anon, authenticated;
grant execute on function public.list_my_reports() to authenticated;

create or replace function public.list_reports_for_staff(p_status text default null)
returns setof public.story_reports
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.has_role(auth.uid(), 'moderator') or public.has_role(auth.uid(), 'admin')) then
    raise exception 'Only a moderator or admin can list reports';
  end if;
  return query
    select * from public.story_reports
    where p_status is null or status = p_status
    order by created_at desc;
end;
$$;

revoke execute on function public.list_reports_for_staff(text) from public, anon, authenticated;
grant execute on function public.list_reports_for_staff(text) to authenticated;

create or replace function public.resolve_report(p_report_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report public.story_reports;
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

  update public.story_reports
    set status = p_status, handled_by = auth.uid(), handled_at = now()
    where id = p_report_id;
end;
$$;

revoke execute on function public.resolve_report(uuid, text) from public, anon, authenticated;
grant execute on function public.resolve_report(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------

create or replace function public.log_editorial_action(
  p_story_id uuid, p_revision_id uuid, p_action_type text, p_summary text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (public.has_role(auth.uid(), 'editor') or public.has_role(auth.uid(), 'admin')) then
    raise exception 'Only an editor or admin can log an editorial action';
  end if;
  insert into public.editorial_actions (story_id, revision_id, editor_id, action_type, summary)
  values (p_story_id, p_revision_id, auth.uid(), p_action_type, p_summary);
end;
$$;

revoke execute on function public.log_editorial_action(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.log_editorial_action(uuid, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Authenticated reads
-- ---------------------------------------------------------------------

create or replace function public.list_my_stories()
returns table (
  id uuid, slug text, source_kind public.story_source_kind, visibility public.story_visibility,
  lifecycle_status public.story_lifecycle_status, current_draft_revision_id uuid,
  published_revision_id uuid, version integer, submitted_at timestamptz, published_at timestamptz,
  archived_at timestamptz, created_at timestamptz, updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.slug, s.source_kind, s.visibility, s.lifecycle_status, s.current_draft_revision_id,
         s.published_revision_id, s.version, s.submitted_at, s.published_at, s.archived_at,
         s.created_at, s.updated_at
  from public.stories s
  left join public.contributors c on c.id = s.contributor_id
  where s.owner_user_id = auth.uid() or c.linked_user_id = auth.uid()
  order by s.updated_at desc;
$$;

revoke execute on function public.list_my_stories() from public, anon, authenticated;
grant execute on function public.list_my_stories() to authenticated;

create or replace function public.get_my_story_with_draft(p_story_id uuid)
returns table (
  story_id uuid, slug text, source_kind public.story_source_kind, visibility public.story_visibility,
  lifecycle_status public.story_lifecycle_status, version integer, assigned_editor_id uuid,
  revision_id uuid, revision_number integer, revision_status public.story_revision_status,
  title text, excerpt text, content_json jsonb, trip_start_date date, trip_end_date date,
  trip_year smallint, travel_style text, total_expense_nzd_cents integer, contributor_note text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public._is_story_owner(p_story_id) then
    raise exception 'Not authorized to read story %', p_story_id;
  end if;
  return query
    select s.id, s.slug, s.source_kind, s.visibility, s.lifecycle_status, s.version, s.assigned_editor_id,
           r.id, r.revision_number, r.revision_status, r.title, r.excerpt, r.content_json,
           r.trip_start_date, r.trip_end_date, r.trip_year, r.travel_style, r.total_expense_nzd_cents,
           r.contributor_note
    from public.stories s
    left join public.story_revisions r
      on r.id = coalesce(s.current_draft_revision_id, s.published_revision_id)
    where s.id = p_story_id;
end;
$$;

revoke execute on function public.get_my_story_with_draft(uuid) from public, anon, authenticated;
grant execute on function public.get_my_story_with_draft(uuid) to authenticated;

create or replace function public.list_assigned_editorial_stories()
returns table (
  id uuid, slug text, lifecycle_status public.story_lifecycle_status, version integer,
  contributor_id uuid, created_at timestamptz, updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.has_role(auth.uid(), 'editor') or public.has_role(auth.uid(), 'admin')) then
    raise exception 'Only an editor or admin can list assigned editorial stories';
  end if;
  return query
    select s.id, s.slug, s.lifecycle_status, s.version, s.contributor_id, s.created_at, s.updated_at
    from public.stories s
    where s.source_kind = 'editorial_import'
      and (s.assigned_editor_id = auth.uid() or public.has_role(auth.uid(), 'admin'))
    order by s.updated_at desc;
end;
$$;

revoke execute on function public.list_assigned_editorial_stories() from public, anon, authenticated;
grant execute on function public.list_assigned_editorial_stories() to authenticated;

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
  if not (v_story.assigned_editor_id = auth.uid() or public.has_role(auth.uid(), 'admin')) then
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

revoke execute on function public.get_story_for_editor(uuid) from public, anon, authenticated;
grant execute on function public.get_story_for_editor(uuid) to authenticated;

create or replace function public.get_story_for_moderator(p_revision_id uuid)
returns table (
  story_id uuid, revision_id uuid, revision_status public.story_revision_status, title text,
  consent_valid boolean, media_processed boolean,
  moderation_action_id uuid, moderation_previous_status public.story_revision_status,
  moderation_new_status public.story_revision_status, moderation_reason text,
  moderation_internal_note text, moderation_created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_story_id uuid;
begin
  if not (public.has_role(auth.uid(), 'moderator') or public.has_role(auth.uid(), 'admin')) then
    raise exception 'Only a moderator or admin can read this view';
  end if;

  select story_id into v_story_id from public.story_revisions where id = p_revision_id;
  if v_story_id is null then raise exception 'No such revision: %', p_revision_id; end if;

  return query
    select v_story_id, r.id, r.revision_status, r.title,
           (public._latest_valid_consent_for_revision(v_story_id, r.id) is not null),
           not exists (
             select 1 from public.story_revision_media rm
             join public.story_media m on m.id = rm.media_id
             where rm.revision_id = r.id
               and (m.approved_public_storage_path is null or m.metadata_removed_at is null)
           ),
           a.id, a.previous_status, a.new_status, a.user_facing_reason, n.internal_note, a.created_at
    from public.story_revisions r
    left join public.moderation_actions a on a.revision_id = r.id
    left join public.moderation_action_notes n on n.action_id = a.id
    where r.id = p_revision_id
    order by a.created_at desc;
end;
$$;

revoke execute on function public.get_story_for_moderator(uuid) from public, anon, authenticated;
grant execute on function public.get_story_for_moderator(uuid) to authenticated;

create or replace function public.get_moderation_queue()
returns table (
  revision_id uuid, story_id uuid, slug text, title text, submitted_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.has_role(auth.uid(), 'moderator') or public.has_role(auth.uid(), 'admin')) then
    raise exception 'Only a moderator or admin can read the moderation queue';
  end if;
  return query
    select r.id, s.id, s.slug, r.title, s.submitted_at
    from public.story_revisions r
    join public.stories s on s.id = r.story_id
    where r.revision_status = 'submitted'
    order by s.submitted_at asc;
end;
$$;

revoke execute on function public.get_moderation_queue() from public, anon, authenticated;
grant execute on function public.get_moderation_queue() to authenticated;
