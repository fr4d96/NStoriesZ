-- Bypasses the Vercel serverless function's inbound request-body ceiling
-- (an unconfigurable ~4.5 MiB effective limit for Node.js Functions, from
-- AWS Lambda's synchronous invocation payload cap plus base64 inflation of
-- binary bodies) for the initial upload. Root-caused live: a real 24MP
-- iPhone HEIC (4.1 MB) was rejected with a 413 carrying a non-JSON body —
-- proof the platform rejected the request before our own route handler
-- (which always returns JSON) ever ran — while a 12MP HEIC from the same
-- phone succeeded every time.
--
-- The fix changes WHERE the raw bytes travel, not the processing pipeline:
-- the browser now uploads directly to Supabase Storage using its own
-- session token, never through the Vercel function. This works with zero
-- new authorization model because storage RLS was already scoped to
-- auth.uid() (the caller's own identity), not "must come from our server"
-- — see _can_write_reserved_media_path below, unchanged in its actual
-- authorization logic. finalize_story_media_upload already verified
-- uploads by querying storage.objects directly rather than trusting
-- caller-supplied bytes, so it needs no changes at all.
--
-- HEIC needs one extra step, because it can never be a final stored format
-- (Engineering Rule 6/14 — sharp/heic-decode only run server-side, and
-- nothing downstream may see a fourth format). The browser stages the raw
-- HEIC directly in the private bucket at the SAME reserved path
-- begin_story_media_upload already returns (now with a .heic extension),
-- a small server call authorizes + transcodes it server-side exactly as
-- before (lib/story/heic.ts is completely unchanged), and the reservation
-- is then rewritten in place to point at the real original.jpg — after
-- which finalize_story_media_upload proceeds exactly as it already did.
-- The raw HEIC is staged only in the PRIVATE bucket and only transiently;
-- the public bucket and its allowed_mime_types are untouched.

-- file_size_limit is a single flat ceiling covering every object in the
-- bucket, staging .heic included -- raised to match MAX_HEIC_UPLOAD_BYTES
-- (lib/story/image-validation.ts, 30 MiB) so a large HEIC's staging upload
-- isn't silently capped back down to 15 MiB by Storage itself, contradicting
-- the ceiling authorize_heic_transcode() explicitly enforces below. This
-- does NOT loosen what can ever be permanently stored: the final
-- original.jpg/png/webp path is still independently held to 15 MiB by
-- finalize_story_media_upload()'s own hardcoded check (unchanged), and the
-- processed derivative is still held to MAX_PROCESSED_BYTES (8 MiB) by
-- record_processed_story_media(). This is strictly a coarser OUTER bound;
-- those RPCs remain the precise inner ones.
update storage.buckets
  set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic'],
      file_size_limit = 31457280
  where id = 'story-images-private';

-- Filename pattern gains .heic, for the transient staging object only —
-- everything else about this function (exact three-part path, valid UUIDs,
-- a matching pending_upload reservation, real edit-rights on the story)
-- is unchanged.
create or replace function public._can_write_reserved_media_path(p_object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parts text[];
  v_story_id_text text;
  v_media_id_text text;
  v_filename text;
  v_uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_media public.story_media;
begin
  if p_object_name is null or p_object_name = '' then return false; end if;
  if p_object_name ~ '%' or p_object_name ~ '\\' or p_object_name ~ '\.\.' then return false; end if;

  v_parts := string_to_array(p_object_name, '/');
  if array_length(v_parts, 1) <> 3 then return false; end if;

  v_story_id_text := v_parts[1];
  v_media_id_text := v_parts[2];
  v_filename := v_parts[3];

  if not (v_story_id_text ~* v_uuid_re) or not (v_media_id_text ~* v_uuid_re) then
    return false;
  end if;
  if v_filename !~ '^original\.(jpg|png|webp|heic)$' then
    return false;
  end if;

  select * into v_media from public.story_media
    where id = v_media_id_text::uuid
      and story_id = v_story_id_text::uuid
      and private_storage_path = p_object_name
      and processing_state = 'pending_upload';
  if not found then return false; end if;

  return exists (
    select 1
    from public.stories s
    left join public.contributors c on c.id = s.contributor_id
    where s.id = v_media.story_id
      and s.current_draft_revision_id = v_media.reserved_for_revision_id
      and (
        s.owner_user_id = auth.uid()
        or c.linked_user_id = auth.uid()
        or s.assigned_editor_id = auth.uid()
      )
  );
end;
$$;

comment on function public._can_write_reserved_media_path(text) is
  'Storage RLS helper for the private bucket''s INSERT policy: strict path parsing, then exact equality against a matching, still-pending, still-editable reservation, authorized by the platform''s real edit-rights relationship set. .heic is a transient staging extension only, rewritten to .jpg by record_heic_transcoded_original before finalize_story_media_upload ever runs. No API grants (used only from within a storage policy).';

-- begin_story_media_upload accepts image/heic now, reserving a .heic path.
-- Everything else (the 12-image-per-revision lock/count, edit-rights via
-- _authorize_revision_edit) is unchanged.
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

  if p_source_mime_type not in ('image/jpeg', 'image/png', 'image/webp', 'image/heic') then
    raise exception 'Unsupported source MIME type: %', p_source_mime_type;
  end if;
  v_ext := case p_source_mime_type
    when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png'
    when 'image/webp' then 'webp'
    when 'image/heic' then 'heic'
  end;

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
  'Reserves a media slot and a private storage path for an upload, uploaded directly by the client afterward (never through this or any Vercel function). image/heic reserves a transient .heic path, rewritten to .jpg by record_heic_transcoded_original before it can ever be finalized. Enforces the 12-image-per-revision limit transactionally, under a lock on the revision row.';

-- Authorizes a HEIC transcode request and hands back exactly what the
-- caller needs to perform it: story_id (for constructing the real
-- original.jpg path) and the staged .heic object's own path (== the
-- reservation's current private_storage_path). Verifies the staged object
-- actually exists and is within the HEIC-specific size ceiling — mirrors
-- finalize_story_media_upload's own "query storage.objects directly, never
-- trust the caller" pattern, at the staging step instead of the final one.
create or replace function public.authorize_heic_transcode(p_media_id uuid)
returns table (story_id uuid, staging_path text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_media public.story_media;
  v_story_id uuid;
  v_object_exists boolean;
  v_object_size bigint;
  -- Matches lib/story/image-validation.ts's MAX_HEIC_UPLOAD_BYTES (30 MiB)
  -- exactly -- both must move together if either changes.
  max_heic_upload_bytes constant bigint := 31457280;
begin
  select * into v_media from public.story_media where id = p_media_id for update;
  if not found then
    raise exception 'No such media: %', p_media_id;
  end if;
  if v_media.processing_state <> 'pending_upload' or v_media.source_mime_type <> 'image/heic' then
    raise exception 'Media % is not a pending HEIC upload', p_media_id;
  end if;

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
    raise exception 'Staged HEIC upload not found for media % at %; please re-upload', p_media_id, v_media.private_storage_path;
  end if;
  if v_object_size is null or v_object_size > max_heic_upload_bytes then
    raise exception 'Staged HEIC object for media % exceeds the maximum allowed size', p_media_id;
  end if;

  return query select v_story_id, v_media.private_storage_path;
end;
$$;

comment on function public.authorize_heic_transcode(uuid) is
  'Authorizes a HEIC transcode request: re-derives edit rights, and verifies the staged .heic object actually exists in storage and is within MAX_HEIC_UPLOAD_BYTES (never trusting the caller''s claim). Returns story_id and the staged object''s path for the caller to download, transcode, and re-upload as original.jpg.';

revoke execute on function public.authorize_heic_transcode(uuid) from public, anon, authenticated;
grant execute on function public.authorize_heic_transcode(uuid) to authenticated;

-- Rewrites a HEIC reservation to point at its transcoded JPEG, in place.
-- Stays at pending_upload throughout (a same-state update, unrestricted by
-- story_media_validate_processing_state_transition() except for the
-- separate `promoted`-immutability case, which does not apply here) so
-- finalize_story_media_upload runs immediately afterward completely
-- unchanged, verifying the NEW path exactly as it would for a non-HEIC
-- upload. p_new_storage_path is checked against the only value it could
-- legitimately be, rather than trusted outright.
create or replace function public.record_heic_transcoded_original(
  p_media_id uuid,
  p_new_storage_path text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_media public.story_media;
  v_story_id uuid;
  v_expected_path text;
begin
  select * into v_media from public.story_media where id = p_media_id for update;
  if not found then
    raise exception 'No such media: %', p_media_id;
  end if;
  if v_media.processing_state <> 'pending_upload'
    or v_media.source_mime_type <> 'image/heic'
    or v_media.private_storage_path !~ '\.heic$'
  then
    raise exception 'Media % is not a pending, unrecorded HEIC transcode', p_media_id;
  end if;

  select public._authorize_revision_edit(v_media.reserved_for_revision_id) into v_story_id;

  v_expected_path := v_story_id::text || '/' || p_media_id::text || '/original.jpg';
  if p_new_storage_path <> v_expected_path then
    raise exception 'Transcoded storage path for media % does not match the expected content path', p_media_id;
  end if;

  update public.story_media
    set private_storage_path = p_new_storage_path,
        source_mime_type = 'image/jpeg'
    where id = p_media_id;
end;
$$;

comment on function public.record_heic_transcoded_original(uuid, text) is
  'Rewrites a HEIC reservation to point at its server-transcoded JPEG (path checked against the only legitimate value, never trusted outright). Stays at pending_upload; finalize_story_media_upload runs immediately after, unchanged, verifying the new path.';

revoke execute on function public.record_heic_transcoded_original(uuid, text) from public, anon, authenticated;
grant execute on function public.record_heic_transcoded_original(uuid, text) to authenticated;
