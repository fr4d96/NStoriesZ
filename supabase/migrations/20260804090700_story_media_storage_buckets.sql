-- Prompt 4: two storage buckets and their RLS policies.
--
-- story-images-private: original uploads and processed-derivative staging.
-- Never public. Writes are gated by _can_write_reserved_media_path(), which
-- verifies the exact database reservation (story/media/path match, pending
-- state, still-editable revision, and the caller passes the platform's real
-- edit-rights rule) — a direct Storage API write to an arbitrary or another
-- user's path fails here, not merely because the app chooses not to do
-- that. Reads are gated by _can_access_story_media(), scoped by object path.
--
-- story-images-public: only processed, promoted derivatives. World-
-- readable by design (that is the entire point). Every write
-- (INSERT/UPDATE/DELETE) is restricted to service_role — the storage-layer
-- half of the same trust boundary as record_processed_story_media()/
-- finalize_story_publication() being service_role/authenticated-only at the
-- database layer. No client, including an authorized owner or moderator,
-- ever writes to this bucket directly.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('story-images-private', 'story-images-private', false, 15728640,
    array['image/jpeg', 'image/png', 'image/webp']),
  ('story-images-public', 'story-images-public', true, 15728640,
    array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Strict reserved-path parsing: exactly three components, the first two
-- valid UUIDs, the third an exact "original.<ext>" filename — no path
-- traversal, backslashes, or percent-encoded separators. Feeds into (does
-- not replace) the exact-equality check against the database-reserved path.
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
  if v_filename !~ '^original\.(jpg|png|webp)$' then
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
  'Storage RLS helper for the private bucket''s INSERT policy: strict path parsing, then exact equality against a matching, still-pending, still-editable reservation, authorized by the platform''s real edit-rights relationship set. No API grants (used only from within a storage policy).';

revoke execute on function public._can_write_reserved_media_path(text) from public, anon, authenticated;

create policy "private media: reserved-path writes only"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'story-images-private'
    and public._can_write_reserved_media_path(name)
  );

create policy "private media: authorized read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'story-images-private'
    and public._can_access_story_media(
      (
        select id from public.story_media
        where story_id = split_part(name, '/', 1)::uuid
          and (private_storage_path = name or processed_private_storage_path = name)
        limit 1
      )
    )
  );

create policy "public media: world-readable"
  on storage.objects for select
  to public
  using (bucket_id = 'story-images-public');

create policy "public media: service-role writes only"
  on storage.objects for insert
  to service_role
  with check (bucket_id = 'story-images-public');

create policy "public media: service-role updates only"
  on storage.objects for update
  to service_role
  using (bucket_id = 'story-images-public')
  with check (bucket_id = 'story-images-public');

create policy "public media: service-role deletes only"
  on storage.objects for delete
  to service_role
  using (bucket_id = 'story-images-public');

create policy "private media: service-role writes"
  on storage.objects for insert
  to service_role
  with check (bucket_id = 'story-images-private');

create policy "private media: service-role deletes"
  on storage.objects for delete
  to service_role
  using (bucket_id = 'story-images-private');
