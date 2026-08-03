-- Prompt 4: the processing step. record_processed_story_media() is called
-- directly by lib/story/image-pipeline.ts (the one module allowed to hold
-- the service-role admin client) once a real sharp decode + magic-byte
-- validation has actually succeeded — it is the only place source/processed
-- MIME/dimensions are ever recorded, and they are always server-detected,
-- never client-supplied. promote_story_media() (Prompt 3, 7-arg signature,
-- never granted) is superseded: its role is absorbed directly into
-- finalize_story_publication() (see the publication migration), since that
-- keeps the promoted-flip and the pointer swap in the exact same
-- transaction rather than two separately-callable steps.

drop function if exists public.promote_story_media(
  uuid, text, text, bigint, integer, integer, text
);

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

  update public.story_media
    set processing_state = 'processing', processing_started_at = coalesce(processing_started_at, now())
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

comment on function public.record_processed_story_media(
  uuid, text, text, integer, integer, text, bigint, integer, integer, text
) is
  'Records a successful, server-side decode/strip/resize result. All MIME/dimension/size values must have been server-detected (never client-supplied) by the caller before invoking this. Rejects a path that does not match the expected content-addressed convention. service_role only.';

revoke execute on function public.record_processed_story_media(
  uuid, text, text, integer, integer, text, bigint, integer, integer, text
) from public, anon, authenticated;
grant execute on function public.record_processed_story_media(
  uuid, text, text, integer, integer, text, bigint, integer, integer, text
) to service_role;

create or replace function public.record_story_media_processing_failed(
  p_media_id uuid,
  p_failure_reason text,
  p_error_code text default null
)
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
  if v_media.processing_state not in ('uploaded', 'failed') then
    raise exception 'Media % is not eligible for processing (state %)', p_media_id, v_media.processing_state;
  end if;

  update public.story_media
    set processing_state = 'processing', processing_started_at = coalesce(processing_started_at, now())
    where id = p_media_id;

  update public.story_media
    set processing_state = 'failed', failure_reason = p_failure_reason, error_code = p_error_code
    where id = p_media_id;
end;
$$;

comment on function public.record_story_media_processing_failed(uuid, text, text) is
  'Records a failed decode/validation attempt. service_role only.';

revoke execute on function public.record_story_media_processing_failed(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.record_story_media_processing_failed(uuid, text, text) to service_role;

-- Copy-attempt lifecycle: begin (flips processed -> promotion_pending and
-- upserts a pending copy-attempt row before any storage copy is
-- attempted), then verified/failed once lib/story/image-pipeline.ts has
-- actually copied and byte-verified (or failed to) the object in the
-- public bucket. Both are called by the same narrow admin-scoped module,
-- never directly by a moderator's own client.

create or replace function public.begin_story_media_copy_attempt(
  p_media_id uuid,
  p_approval_attempt_id uuid
)
returns table (public_path text, content_hash text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_media public.story_media;
  v_attempt public.story_publication_attempts;
  v_ext text;
  v_public_path text;
begin
  select * into v_attempt from public.story_publication_attempts
    where id = p_approval_attempt_id for update;
  if not found then
    raise exception 'No such publication attempt: %', p_approval_attempt_id;
  end if;
  if v_attempt.status <> 'active' then
    raise exception 'Publication attempt % is not active (status %)', p_approval_attempt_id, v_attempt.status;
  end if;
  if not (v_attempt.initiated_by = auth.uid() or public.has_role(auth.uid(), 'admin')) then
    raise exception 'Only the initiating moderator or an admin may act on this publication attempt';
  end if;

  select * into v_media from public.story_media where id = p_media_id for update;
  if not found then
    raise exception 'No such media: %', p_media_id;
  end if;
  if not exists (
    select 1 from public.story_revision_media
    where revision_id = v_attempt.revision_id and media_id = p_media_id
  ) then
    raise exception 'Media % is not attached to revision %', p_media_id, v_attempt.revision_id;
  end if;

  if v_media.processing_state = 'promotion_pending' then
    -- Retry: already flipped for this or a prior attempt at this exact
    -- attempt id — return the existing copy-attempt's recorded target.
    return query
      select cca.public_path, cca.content_hash
      from public.story_media_public_copy_attempts cca
      where cca.media_id = p_media_id and cca.approval_attempt_id = p_approval_attempt_id;
    return;
  end if;
  if v_media.processing_state <> 'processed' then
    raise exception 'Media % is not ready to be copied for publication (state %)', p_media_id, v_media.processing_state;
  end if;

  v_ext := case v_media.processed_mime_type
    when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png'
    when 'image/webp' then 'webp'
  end;
  v_public_path := v_media.story_id::text || '/' || p_media_id::text || '/' || v_media.sha256 || '.' || v_ext;

  update public.story_media set processing_state = 'promotion_pending' where id = p_media_id;

  insert into public.story_media_public_copy_attempts (
    approval_attempt_id, revision_id, media_id, content_hash, public_path, status
  )
  values (p_approval_attempt_id, v_attempt.revision_id, p_media_id, v_media.sha256, v_public_path, 'pending')
  on conflict (approval_attempt_id, media_id) do update
    set status = 'pending', attempt_count = story_media_public_copy_attempts.attempt_count + 1, updated_at = now();

  return query select v_public_path, v_media.sha256;
end;
$$;

comment on function public.begin_story_media_copy_attempt(uuid, uuid) is
  'Flips processed -> promotion_pending and records intent (a durable copy-attempt row) BEFORE any public-bucket write is attempted. service_role only.';

revoke execute on function public.begin_story_media_copy_attempt(uuid, uuid) from public, anon, authenticated;
grant execute on function public.begin_story_media_copy_attempt(uuid, uuid) to service_role;

create or replace function public.record_story_media_copy_verified(
  p_media_id uuid,
  p_approval_attempt_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.story_media_public_copy_attempts
    set status = 'verified', updated_at = now()
    where media_id = p_media_id and approval_attempt_id = p_approval_attempt_id and status <> 'verified';
  if not found then
    -- Either already verified (idempotent no-op) or no such row — tell them apart.
    if not exists (
      select 1 from public.story_media_public_copy_attempts
      where media_id = p_media_id and approval_attempt_id = p_approval_attempt_id and status = 'verified'
    ) then
      raise exception 'No copy attempt found for media % / attempt %', p_media_id, p_approval_attempt_id;
    end if;
  end if;
end;
$$;

revoke execute on function public.record_story_media_copy_verified(uuid, uuid) from public, anon, authenticated;
grant execute on function public.record_story_media_copy_verified(uuid, uuid) to service_role;

create or replace function public.record_story_media_copy_failed(
  p_media_id uuid,
  p_approval_attempt_id uuid,
  p_error_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.story_media_public_copy_attempts
    set status = 'failed', error_code = p_error_code, updated_at = now()
    where media_id = p_media_id and approval_attempt_id = p_approval_attempt_id;
  if not found then
    raise exception 'No copy attempt found for media % / attempt %', p_media_id, p_approval_attempt_id;
  end if;
end;
$$;

revoke execute on function public.record_story_media_copy_failed(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.record_story_media_copy_failed(uuid, uuid, text) to service_role;
