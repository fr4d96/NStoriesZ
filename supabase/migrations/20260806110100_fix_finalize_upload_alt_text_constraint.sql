-- Bug fix: image upload was still broken after the grant fix in
-- 20260806110000 -- every single call to finalize_story_media_upload()
-- (the function that creates the story_revision_media join row right after
-- a real upload lands) unconditionally violated
-- story_revision_media_alt_text_required
-- (`check (decorative or (alt_text is not null and char_length(alt_text) > 0))`,
-- 20260803090400_story_media.sql), reproduced live:
--   {"code":"23514", "message":"new row for relation \"story_revision_media\"
--    violates check constraint \"story_revision_media_alt_text_required\""}
--
-- Root cause: the insert hardcoded `decorative = false` with no `alt_text`
-- (column default null) -- but alt text is only ever collected AFTER a
-- successful upload, via the image manager's caption UI calling
-- update_story_media_caption() (see components/story/image-upload-manager.tsx
-- and app/(contributor)/stories/[id]/edit/actions.ts#updateMediaCaptionAction).
-- There was no way to reach that step: the initial insert this function
-- performs always failed first, on every image, for every contributor and
-- editor, since begin_/finalize_story_media_upload were introduced in
-- 20260804090100 -- confirmed by direct query against the live project
-- (zero rows ever existed in story_revision_media).
--
-- Fixed by inserting with `decorative = true` instead of `false`: a
-- freshly-attached image with no alt text yet is exactly what "decorative,
-- no alt text needed" is for, and it satisfies the constraint without
-- fabricating alt text. The existing UI/UX flow is unchanged -- a
-- contributor/editor unchecks "Decorative" and fills in real alt text via
-- the already-built caption UI, which was always the intended next step;
-- this only fixes the placeholder value the row is born with so it can be
-- created at all.

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

  -- decorative = true (not false): no alt text has been collected yet at
  -- this point, and story_revision_media_alt_text_required forbids
  -- alt_text is null unless decorative is true. See migration header.
  insert into public.story_revision_media (revision_id, media_id, decorative, sort_order)
  values (v_media.reserved_for_revision_id, p_media_id, true, v_next_sort);

  update public.story_media
    set source_file_size_bytes = v_object_size,
        processing_state = 'uploaded'
    where id = p_media_id;

  update public.stories set version = version + 1 where id = v_story_id;
end;
$$;

comment on function public.finalize_story_media_upload(uuid, integer) is
  'Verifies the reserved object exists and reads its true stored size (never client-supplied), then creates the revision-media join (decorative=true placeholder, since no alt text exists yet) and bumps the authoring version exactly once. Retryable after a stale-version error without re-uploading bytes: existence/access/state checks (which do not depend on version) run first, and a repeat call after the row has already moved past pending_upload is a safe no-op.';

revoke execute on function public.finalize_story_media_upload(uuid, integer) from public, anon, authenticated;
grant execute on function public.finalize_story_media_upload(uuid, integer) to authenticated;
