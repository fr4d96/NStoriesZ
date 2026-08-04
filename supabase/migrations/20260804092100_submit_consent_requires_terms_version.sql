-- Prompt 4 Sub-phase 4: three fixes bundled into one DROP+CREATE of
-- submit_revision_with_consent(), because all three are genuine defects in
-- the very same function and it is already undergoing a signature-forcing
-- rewrite for the first of them:
--
-- 1. [Plan item 2] Terms-of-service version is now a REQUIRED parameter
--    (p_expected_terms_version), not an internal-only constant the caller
--    never confirms against. A mismatch raises with a stable SQLSTATE
--    ('WHV01'), not just a message prefix, so lib/story/rpc-errors.ts can
--    detect it structurally -- the same pattern already used for '23505' in
--    app/(contributor)/actions.ts#createOwnContributorAction. Two small new
--    reader functions (current_terms_version(), get_consent_terms_version())
--    give the client an authoritative source for both "what to submit" and
--    "what was actually recorded" without duplicating the version string.
--
-- 2. [Found during Sub-phase 4 inspection, not named in the round-6 plan's
--    list of 4] The `confirmation_method = 'account'` branch checked only
--    `auth.uid() <> v_contributor.linked_user_id`, with NO check against
--    `v_story.owner_user_id` for a self-service story. This is the same
--    "OR-across-source-kinds" bug class as _is_story_owner()/list_my_stories()/
--    get_story_preview()/_can_write_reserved_media_path() (fixed in the
--    sibling migration 20260804092200), but on a function that inlines its
--    own comparison rather than calling _is_story_owner(). Today this is
--    silently correct only because a self-service contributor's
--    linked_user_id always equals owner_user_id at creation time -- but if
--    that contributor is later unlinked/relinked to a different account
--    (exactly the scenario the new contributor-link RPCs in migration
--    20260804092400 make possible), the newly-linked account would satisfy
--    `auth.uid() = linked_user_id` and could submit consent for the
--    ORIGINAL owner's self-service story. Fixed by source-kind-partitioning
--    this check exactly like the others: self_submitted checks
--    owner_user_id only, editorial_import checks the live linked_user_id
--    only.
--
-- 3. [Found during Sub-phase 4 inspection -- the "awaiting-approval
--    submission dead-end"] _revision_is_editable() requires
--    `lifecycle_status in ('draft', 'published')`.
--    mark_editorial_draft_awaiting_approval() sets
--    `lifecycle_status = 'awaiting_contributor_approval'` and leaves
--    current_draft_revision_id pointed at that same revision. Net effect: a
--    linked contributor had NO way to actually approve (submit-with-consent)
--    an editorial-import draft awaiting their review -- the one RPC that
--    workflow's "approve" action needs structurally rejected it. Fixed with
--    a narrow, same-revision-only carve-out inside this function, not by
--    widening _revision_is_editable() itself (which must keep rejecting
--    every OTHER field-editing RPC while a draft awaits contributor review --
--    that "frozen for review" behavior is intentional and undisturbed here).

-- Single source of truth for the current terms-of-service version string,
-- used both by submit_revision_with_consent() below and by clients that
-- need to know what to pass as p_expected_terms_version before submitting.
create or replace function public.current_terms_version()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select 'whv-compass-terms-2026-08'::text;
$$;

comment on function public.current_terms_version() is
  'The platform''s current terms-of-service version string. Callers fetch this immediately before calling submit_revision_with_consent() and pass it as p_expected_terms_version; a mismatch at submission time (the terms changed in between) raises WHV01.';

revoke execute on function public.current_terms_version() from public, anon, authenticated;
grant execute on function public.current_terms_version() to authenticated;

-- Revision-scoped reader: what terms version was actually recorded against
-- a specific revision's consent grant, if any. Authorized the same way as
-- get_my_story_with_draft() (owner/linked contributor via _is_story_owner,
-- OR the story's assigned editor, OR admin) -- never a blanket "any
-- signed-in user" read.
create or replace function public.get_consent_terms_version(p_revision_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_story_id uuid;
begin
  select story_id into v_story_id from public.story_revisions where id = p_revision_id;
  if v_story_id is null then
    raise exception 'No such revision: %', p_revision_id;
  end if;

  if not (
    public._is_story_owner(v_story_id)
    or exists (select 1 from public.stories where id = v_story_id and assigned_editor_id = auth.uid())
    or public.has_role(auth.uid(), 'admin')
  ) then
    raise exception 'Not authorized to read consent info for revision %', p_revision_id;
  end if;

  return (
    select terms_version from public.story_publication_consents where revision_id = p_revision_id
  );
end;
$$;

comment on function public.get_consent_terms_version(uuid) is
  'The terms_version recorded on this exact revision''s consent grant, or null if it has never been submitted. Revision-scoped, never a story-wide "latest" value, since consent is bound to one immutable revision.';

revoke execute on function public.get_consent_terms_version(uuid) from public, anon, authenticated;
grant execute on function public.get_consent_terms_version(uuid) to authenticated;

-- Drop the old 7-parameter overload before creating the new 8-parameter one
-- -- CREATE OR REPLACE cannot change a function's parameter list, it would
-- silently create a second overload instead of replacing this one.
drop function if exists public.submit_revision_with_consent(
  uuid, integer, text, boolean, boolean, public.identifiable_people_state, boolean
);

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

  -- Fix 3: the awaiting-approval dead-end. A revision is normally
  -- submittable only while _revision_is_editable() (the ordinary
  -- first-submission / replacement-authoring path). The one narrow
  -- exception: this exact revision is the story's current draft pointer
  -- AND the story is awaiting THIS contributor's approval of it -- that is
  -- precisely the "approve" action of the contributor-review workflow, and
  -- nothing else (no other RPC gets this exception; _revision_is_editable()
  -- itself is unchanged, so every other field-editing RPC still correctly
  -- rejects writes while a draft awaits contributor review).
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

  -- Fix 1: terms-of-service version must match the current one, or the
  -- caller reviewed a since-superseded version. Stable SQLSTATE so
  -- lib/story/rpc-errors.ts#isTermsChangedError() can detect this
  -- structurally rather than by message-sniffing.
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

  -- Fix 2: source-kind-partitioned account-confirmation check. Never an OR
  -- across owner_user_id and linked_user_id regardless of source_kind --
  -- self_submitted checks owner_user_id only, editorial_import checks the
  -- live linked_user_id only.
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

comment on function public.submit_revision_with_consent(
  uuid, integer, text, boolean, text, boolean, public.identifiable_people_state, boolean
) is
  'Prompt 4 Sub-phase 4: requires p_expected_terms_version (raises WHV01 on mismatch), source-kind-partitions the account-confirmation check, and allows submission of the current draft revision while the story is awaiting THIS contributor''s approval (the contributor-review "approve" action) in addition to the ordinary _revision_is_editable() path.';

revoke execute on function public.submit_revision_with_consent(
  uuid, integer, text, boolean, text, boolean, public.identifiable_people_state, boolean
) from public, anon, authenticated;
grant execute on function public.submit_revision_with_consent(
  uuid, integer, text, boolean, text, boolean, public.identifiable_people_state, boolean
) to authenticated;
