-- Make re-processing a `failed` media actually possible.
--
-- record_processed_story_media has always *intended* to support this: its
-- eligibility check explicitly admits 'failed' alongside 'uploaded', and its
-- final update clears failure_reason/error_code. But it moves the row through
-- an intermediate 'processing' state first, and that statement left the old
-- failure fields in place. story_media_failure_fields_require_failed
-- (20260804090000_story_media_processing_state.sql) is a biconditional --
--   (failure_reason is not null or error_code is not null) = (state = 'failed')
-- -- and CHECK constraints are evaluated per statement, not at commit. So the
-- intermediate write always violated it and the whole function raised 23514.
--
-- Net effect: every media that ever failed processing was stranded
-- permanently, with no recovery path except deleting it and re-uploading the
-- photo. Found while repairing the 12 media stranded by the upload byte-
-- corruption bug (fixed in lib/story/raw-storage-http.ts): all 12 re-processed
-- and re-verified correctly, then failed at this constraint.
--
-- The fix is to clear the failure fields on the same statement that leaves
-- 'failed', which is the only way to satisfy a per-statement biconditional.
-- Nothing else about the function changes: same eligibility rules, same
-- validation, same content-addressed path enforcement, same final state.

create or replace function public.record_processed_story_media(
  p_media_id uuid,
  p_processed_private_storage_path text,
  p_source_mime_type text,
  p_source_width integer,
  p_source_height integer,
  p_processed_mime_type text,
  p_processed_file_size_bytes bigint,
  p_processed_width integer,
  p_processed_height integer,
  p_sha256 text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_media public.story_media;
  v_expected_ext text;
  v_expected_path text;
begin
  select * into v_media from public.story_media where id = p_media_id for update;
  if not found then
    raise exception 'No such media: %', p_media_id;
  end if;
  if v_media.processing_state not in ('uploaded', 'failed') then
    raise exception 'Media % is not eligible for processing (state %)', p_media_id, v_media.processing_state;
  end if;

  if p_source_mime_type not in ('image/jpeg', 'image/png', 'image/webp')
    or p_processed_mime_type not in ('image/jpeg', 'image/png', 'image/webp') then
    raise exception 'Unsupported MIME type for media %', p_media_id;
  end if;
  if p_source_width <= 0 or p_source_height <= 0 or p_processed_width <= 0 or p_processed_height <= 0 then
    raise exception 'Invalid dimensions for media %', p_media_id;
  end if;
  if p_processed_file_size_bytes <= 0 then
    raise exception 'Invalid processed size for media %', p_media_id;
  end if;
  if p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid sha256 for media %', p_media_id;
  end if;

  v_expected_ext := case p_processed_mime_type
    when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png'
    when 'image/webp' then 'webp'
  end;
  v_expected_path := v_media.story_id::text || '/' || p_media_id::text || '/processed-' || p_sha256 || '.' || v_expected_ext;
  if p_processed_private_storage_path <> v_expected_path then
    raise exception 'Processed storage path for media % does not match the expected content-addressed path', p_media_id;
  end if;

  -- failure_reason/error_code are cleared HERE, not only in the update
  -- below: leaving 'failed' and holding failure fields cannot coexist in a
  -- single statement under story_media_failure_fields_require_failed. This
  -- is the entire fix.
  update public.story_media
    set processing_state = 'processing',
        processing_started_at = coalesce(processing_started_at, now()),
        failure_reason = null,
        error_code = null
    where id = p_media_id;

  update public.story_media
    set processing_state = 'processed',
        processed_private_storage_path = p_processed_private_storage_path,
        source_mime_type = p_source_mime_type,
        source_width = p_source_width,
        source_height = p_source_height,
        processed_mime_type = p_processed_mime_type,
        processed_file_size_bytes = p_processed_file_size_bytes,
        processed_width = p_processed_width,
        processed_height = p_processed_height,
        sha256 = p_sha256,
        metadata_removed_at = now(),
        failure_reason = null,
        error_code = null
    where id = p_media_id;
end;
$$;
