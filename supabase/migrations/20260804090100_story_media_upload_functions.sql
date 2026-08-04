-- Prompt 4: upload reservation — begin_story_media_upload /
-- finalize_story_media_upload / cancel_pending_story_media_upload replace
-- Prompt 3's single-step attach_story_media() for the upload path. See
-- docs/architecture.md "Upload reservation flow".
--
-- Design: the DB row is created BEFORE the storage write, but as an
-- explicit reservation (processing_state = 'pending_upload'), never a claim
-- that bytes exist. finalize_ is the step that runs after the storage write
-- succeeds. Authorization for both is exactly `_authorize_revision_edit()`
-- — the platform's single real edit-rights rule, reused verbatim rather
-- than a separately maintained relationship list that could drift from it.
-- (`_authorize_revision_edit` in turn uses `_is_story_owner`, which already
-- treats a linked contributor as equivalent to the story's owner for
-- editing purposes — existing Prompt 3 behavior, not something Prompt 4
-- narrows or widens.)

-- attach_story_media() (Prompt 3) is superseded by begin_/finalize_ for the
-- upload path. Nothing in the app ever called it (confirmed: only an unused
-- lib/story/mutations.ts wrapper referenced it). Dropped rather than left
-- in place referencing since-renamed columns (width/height ->
-- processed_width/processed_height), which would otherwise be a landmine
-- for anything that accidentally called it later.
drop function if exists public.attach_story_media(
  uuid, integer, text, text, integer, integer, bigint, text, text, boolean
);

create or replace function public.begin_story_media_upload(
  p_revision_id uuid,
  p_source_mime_type text
)
returns table (media_id uuid, reserved_path text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_story_id uuid;
  v_media_id uuid;
  v_ext text;
  v_reserved_path text;
  v_attached_count integer;
  v_pending_count integer;
  max_images_per_revision constant integer := 12;
begin
  select public._authorize_revision_edit(p_revision_id) into v_story_id;

  if p_source_mime_type not in ('image/jpeg', 'image/png', 'image/webp') then
    raise exception 'Unsupported source MIME type: %', p_source_mime_type;
  end if;
  v_ext := case p_source_mime_type
    when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png'
    when 'image/webp' then 'webp'
  end;

  -- Lock the revision row for the duration of the count check + insert, so
  -- two concurrent begin_ calls for the same revision can't both slip past
  -- the limit.
  perform 1 from public.story_revisions where id = p_revision_id for update;

  select count(*) into v_attached_count
  from public.story_revision_media where revision_id = p_revision_id;
  select count(*) into v_pending_count
  from public.story_media
  where reserved_for_revision_id = p_revision_id and processing_state = 'pending_upload';

  if v_attached_count + v_pending_count >= max_images_per_revision then
    raise exception 'Revision % already has % images attached or reserved (max %)',
      p_revision_id, v_attached_count + v_pending_count, max_images_per_revision;
  end if;

  v_media_id := gen_random_uuid();
  v_reserved_path := v_story_id::text || '/' || v_media_id::text || '/original.' || v_ext;

  insert into public.story_media (
    id, story_id, owner_user_id, uploaded_by, private_storage_path, source_mime_type,
    reserved_for_revision_id, processing_state
  )
  select
    v_media_id, v_story_id,
    case when s.source_kind = 'self_submitted' then auth.uid() else null end,
    auth.uid(), v_reserved_path, p_source_mime_type, p_revision_id, 'pending_upload'
  from public.stories s where s.id = v_story_id;

  return query select v_media_id, v_reserved_path;
end;
$$;

comment on function public.begin_story_media_upload(uuid, text) is
  'Reserves a media slot and a private storage path for an upload. Does not touch the authoring version — a reservation is not yet attached content. Enforces the 12-image-per-revision limit transactionally, under a lock on the revision row.';

revoke execute on function public.begin_story_media_upload(uuid, text) from public, anon, authenticated;
grant execute on function public.begin_story_media_upload(uuid, text) to authenticated;

create or replace function public.finalize_story_media_upload(
  p_media_id uuid,
  p_expected_version integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_media public.story_media;
  v_story_id uuid;
  v_story public.stories;
  v_object_exists boolean;
  v_object_size bigint;
  max_upload_bytes constant bigint := 15728640; -- 15 MiB
  v_next_sort integer;
begin
  select * into v_media from public.story_media where id = p_media_id for update;
  if not found then
    raise exception 'No such media: %', p_media_id;
  end if;

  -- Idempotent: a prior finalize call for this exact media already
  -- succeeded (state has moved past pending_upload) — safe to call twice.
  if v_media.processing_state <> 'pending_upload' then
    return;
  end if;

  -- Re-derive edit authorization independently — never trust that
  -- begin_story_media_upload's earlier check is still valid.
  select public._authorize_revision_edit(v_media.reserved_for_revision_id) into v_story_id;

  select exists (
    select 1 from storage.objects
    where bucket_id = 'story-images-private' and name = v_media.private_storage_path
  ), (
    select (metadata ->> 'size')::bigint from storage.objects
    where bucket_id = 'story-images-private' and name = v_media.private_storage_path
  )
  into v_object_exists, v_object_size;

  if not v_object_exists then
    raise exception 'Upload not found for media % at %; please re-upload', p_media_id, v_media.private_storage_path;
  end if;
  if v_object_size is null or v_object_size > max_upload_bytes then
    raise exception 'Uploaded object for media % exceeds the maximum allowed size', p_media_id;
  end if;

  select * into v_story from public.stories where id = v_story_id;
  if v_story.version <> p_expected_version then
    raise exception 'Stale version for story % (expected %, got %)', v_story_id, v_story.version, p_expected_version;
  end if;

  select coalesce(max(sort_order), -1) + 1 into v_next_sort
  from public.story_revision_media where revision_id = v_media.reserved_for_revision_id;

  insert into public.story_revision_media (revision_id, media_id, decorative, sort_order)
  values (v_media.reserved_for_revision_id, p_media_id, false, v_next_sort);

  update public.story_media
    set source_file_size_bytes = v_object_size,
        processing_state = 'uploaded'
    where id = p_media_id;

  update public.stories set version = version + 1 where id = v_story_id;
end;
$$;

comment on function public.finalize_story_media_upload(uuid, integer) is
  'Verifies the reserved object exists and reads its true stored size (never client-supplied), then creates the revision-media join and bumps the authoring version exactly once. Retryable after a stale-version error without re-uploading bytes: existence/access/state checks (which do not depend on version) run first, and a repeat call after the row has already moved past pending_upload is a safe no-op.';

revoke execute on function public.finalize_story_media_upload(uuid, integer) from public, anon, authenticated;
grant execute on function public.finalize_story_media_upload(uuid, integer) to authenticated;

create or replace function public.cancel_pending_story_media_upload(p_media_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_media public.story_media;
begin
  select * into v_media from public.story_media where id = p_media_id for update;
  if not found then
    raise exception 'No such media: %', p_media_id;
  end if;
  if v_media.processing_state <> 'pending_upload' then
    raise exception 'Media % is not a pending, unattached upload', p_media_id;
  end if;

  -- A still-pending_upload row is by construction not yet shared with any
  -- revision's story_revision_media join, so there is no reference-count
  -- race to worry about here (contrast with detach-and-retain for attached
  -- media, decision documented in docs/architecture.md).
  perform public._authorize_revision_edit(v_media.reserved_for_revision_id);

  delete from public.story_media where id = p_media_id;
end;
$$;

comment on function public.cancel_pending_story_media_upload(uuid) is
  'Deletes a still-pending_upload reservation. Never touches the authoring version — cancelling a reservation that was never attached is not a content change.';

revoke execute on function public.cancel_pending_story_media_upload(uuid) from public, anon, authenticated;
grant execute on function public.cancel_pending_story_media_upload(uuid) to authenticated;
