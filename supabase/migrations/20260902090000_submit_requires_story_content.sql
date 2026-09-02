-- Moderation enhancement, part 1 of 2: an empty story can no longer be
-- submitted for review.
--
-- WHY THIS EXISTS
--
-- 14 of the ~22 revisions sitting in the live moderation queue have
-- `content_json = '[]'::jsonb` -- a genuinely empty document. They were
-- created as title-only shells and submitted in a burst without ever being
-- written (every one of those rows' `updated_at` moved for the first time
-- at submit time, so no content was lost; there was never any). The review
-- page then calls normalizeStoryContentJson(), which correctly refuses to
-- treat `[]` as content and returns null, and the moderator is shown
-- "Could not render submitted content." on story after story -- an error
-- message for something that is not an error.
--
-- The "add a title and some story content before you can submit" gate
-- exists (lib/story/steps.ts#missingStoryRequirements, enforced by both the
-- editor and the preview page), but it is UI-only and postdates those
-- submissions. Engineering Rule 2 says client-supplied state is re-derived
-- and verified server-side on every mutation, and this is exactly that
-- case: the RPC is the trust boundary, so the RPC checks.
--
-- WHAT COUNTS AS CONTENT
--
-- Deliberately the same rule the UI gate applies -- "is there any
-- non-whitespace text in the document" -- not a stricter word count or a
-- schema re-validation:
--
--   * A word count would be a NEW editorial policy ("how long is long
--     enough"), which is not an engineering call to make inside a
--     migration.
--   * Re-validating against today's storyContentSchema in SQL is
--     impossible (that schema lives in Zod) and would in any case reject
--     legacy block shapes that are still legitimately submittable.
--
-- _content_json_text_length() therefore just sums the non-whitespace length
-- of every `text` leaf, at any depth, in ANY historical content_json shape:
-- today's single `{type:"markdown", text:"..."}` block, the older
-- paragraph/heading/quote/list block union whose text is a `TextRun[]`, and
-- the oldest plain-string variant. It mirrors what
-- lib/story/legacy-content.ts can actually read back, so the DB and the app
-- agree on "this document has something in it".
--
-- An image-only story still passes: the `![[<mediaId>]]` embed token is
-- text inside the markdown block, so it has a length. That matches
-- missingStoryRequirements(), which reads the same string.

create or replace function public._content_json_text_length(p_content jsonb)
returns integer
language sql
immutable
set search_path = ''
as $$
  select coalesce(sum(char_length(btrim(x.t))), 0)::integer
  from jsonb_path_query(
         case
           when jsonb_typeof(p_content) = 'array' then p_content
           else '[]'::jsonb
         end,
         'strict $.**.text'
       ) as e,
       lateral (
         select case when jsonb_typeof(e) = 'string' then e #>> '{}' else '' end
       ) as x(t);
$$;

comment on function public._content_json_text_length(jsonb) is
  'Total non-whitespace character length of every `text` leaf in a content_json document, at any depth, in any historical block shape (markdown / paragraph-heading-quote-list with TextRun[] / plain-string text). Internal helper -- the "does this revision have any content at all" test shared by submit_revision_with_consent() and get_moderation_queue(). Not a substitute for storyContentSchema, which stays the real validator in lib/validation/story.ts.';

revoke execute on function public._content_json_text_length(jsonb) from public, anon;

-- submit_revision_with_consent(): unchanged in every respect except the new
-- content check. Copied verbatim from the live definition (itself the
-- product of 20260803090700 + 20260804090500 + 20260804092100 +
-- 20260804092200 + 20260804092700) so this migration is a readable diff of
-- one added block rather than a rewrite.
--
-- Placement: with the other revision-integrity checks, immediately after
-- the submittability check and BEFORE the consent/terms/attribution
-- checks. Rationale -- "you haven't written anything yet" is the most
-- actionable thing we can tell a contributor, and it is true regardless of
-- whether their terms version is current, so it should not be hidden
-- behind a terms-version mismatch.
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

  -- NEW: no empty submissions. See this migration's header comment.
  if public._content_json_text_length(v_revision.content_json) = 0 then
    raise exception using
      errcode = 'WHV03',
      message = 'This story has no content yet — write something before submitting it for review.';
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
  'Records consent and moves a draft revision to submitted. Raises WHV01 when the caller''s expected terms version is stale, and WHV03 when the revision has no story content at all (added 20260902090000 — the moderation queue had filled with title-only shells because that rule lived only in the UI).';
