-- Prompt 4 Sub-phase 4, bug fix: source-kind-partitioned authorization.
--
-- Four functions compared BOTH stories.owner_user_id and the story's
-- contributor's (live) linked_user_id against auth.uid() with an OR (or an
-- unconditional if/elsif chain, in get_story_preview()'s case) --
-- regardless of the story's source_kind. That is wrong in both directions:
--
--   - For a self-service story (source_kind = 'self_submitted'), the ONLY
--     authoritative owner is stories.owner_user_id, fixed at creation and
--     never re-derived from contributor linkage. If that contributor's
--     linked_user_id is later changed (the new link_contributor_to_user()/
--     unlink_contributor_from_user() RPCs, migration 20260804092400, make
--     this a normal, audited operation an editor can perform on ANY
--     contributor record, not just editorial-import ones), a NEWLY linked,
--     unrelated account would satisfy `c.linked_user_id = auth.uid()` and
--     gain access to a self-service story it has no relationship to at all.
--
--   - For an editorial-import story (source_kind = 'editorial_import'),
--     stories.owner_user_id is a stale creation-time snapshot of whoever
--     was linked at the moment create_editorial_import_draft() ran (often
--     null, since editorial imports frequently start against an unlinked
--     contributor) -- it is never updated afterward. Checking it for
--     authorization on an editorial-import story is checking a value that
--     can be outright wrong the moment the contributor is linked, relinked,
--     or was never linked when the story was created.
--
-- The fix, applied identically in all four places: partition the check by
-- source_kind, never OR across both fields regardless of source_kind.
-- self_submitted checks owner_user_id only; editorial_import checks the
-- live contributors.linked_user_id only. assigned_editor_id/admin checks
-- (where present) stay unconditional -- they are a different, always-valid
-- relationship in both source kinds, not part of this partition.
--
-- A fifth site with the same bug (submit_revision_with_consent()'s
-- confirmation_method = 'account' branch) is fixed in the sibling migration
-- 20260804092100, alongside that function's other Sub-phase 4 changes,
-- since it was already undergoing a DROP+CREATE there.

create or replace function public._is_story_owner(p_story_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.stories s
    left join public.contributors c on c.id = s.contributor_id
    where s.id = p_story_id
      and (
        (s.source_kind = 'self_submitted' and s.owner_user_id = auth.uid())
        or (s.source_kind = 'editorial_import' and c.linked_user_id = auth.uid())
      )
  );
$$;

comment on function public._is_story_owner(uuid) is
  'Internal: source-kind-partitioned. self_submitted checks owner_user_id only; editorial_import checks the live linked contributor only -- never an OR across both regardless of source_kind (fixed in Prompt 4 Sub-phase 4; see this migration''s header comment). No API grants.';

revoke execute on function public._is_story_owner(uuid) from public, anon, authenticated;

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
  where (s.source_kind = 'self_submitted' and s.owner_user_id = auth.uid())
     or (s.source_kind = 'editorial_import' and c.linked_user_id = auth.uid())
  order by s.updated_at desc;
$$;

revoke execute on function public.list_my_stories() from public, anon, authenticated;
grant execute on function public.list_my_stories() to authenticated;

create or replace function public.get_story_preview(p_story_id uuid)
returns table (
  story_id uuid,
  title text,
  excerpt text,
  content_json jsonb,
  trip_start_date date,
  trip_end_date date,
  trip_year smallint,
  travel_style text,
  total_expense_nzd_cents integer,
  source_kind public.story_source_kind,
  lifecycle_status public.story_lifecycle_status,
  revision_id uuid,
  revision_status public.story_revision_status,
  version integer,
  attribution_type public.attribution_type,
  attribution_value text,
  viewer_relationship text,
  media jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_story public.stories;
  v_revision_id uuid;
  v_contributor public.contributors;
  v_relationship text;
begin
  select * into v_story from public.stories where id = p_story_id;
  if not found then raise exception 'No such story: %', p_story_id; end if;
  select * into v_contributor from public.contributors where id = v_story.contributor_id;

  -- Source-kind-partitioned: self_submitted only ever checks owner_user_id,
  -- editorial_import only ever checks the live linked contributor. Never an
  -- OR/elsif fallthrough across both regardless of source_kind (see this
  -- migration's header comment). assigned_editor_id and admin are checked
  -- unconditionally in both branches -- a different, always-valid
  -- relationship, not part of this partition.
  if v_story.source_kind = 'self_submitted' then
    if v_story.owner_user_id = auth.uid() then
      v_relationship := 'owner';
    elsif v_story.assigned_editor_id = auth.uid() then
      v_relationship := 'assigned_editor';
    elsif public.has_role(auth.uid(), 'admin') then
      v_relationship := 'admin';
    else
      raise exception 'Not authorized to preview story %', p_story_id;
    end if;
  else
    if v_contributor.linked_user_id = auth.uid() then
      v_relationship := 'linked_contributor';
    elsif v_story.assigned_editor_id = auth.uid() then
      v_relationship := 'assigned_editor';
    elsif public.has_role(auth.uid(), 'admin') then
      v_relationship := 'admin';
    else
      raise exception 'Not authorized to preview story %', p_story_id;
    end if;
  end if;

  v_revision_id := coalesce(v_story.current_draft_revision_id, v_story.published_revision_id);
  if v_revision_id is null then
    raise exception 'Story % has no revision to preview', p_story_id;
  end if;

  return query
    select
      v_story.id, r.title, r.excerpt, r.content_json, r.trip_start_date, r.trip_end_date,
      r.trip_year, r.travel_style, r.total_expense_nzd_cents, v_story.source_kind,
      v_story.lifecycle_status, r.id, r.revision_status, v_story.version,
      v_contributor.attribution_type, v_contributor.display_name, v_relationship,
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'mediaId', rm.media_id,
              'sortOrder', rm.sort_order,
              'isCover', rm.is_cover,
              'altText', rm.alt_text,
              'caption', rm.caption,
              'decorative', rm.decorative,
              'processingState', m.processing_state
            )
            order by rm.sort_order
          )
          from public.story_revision_media rm
          join public.story_media m on m.id = rm.media_id
          where rm.revision_id = r.id
        ),
        '[]'::jsonb
      )
    from public.story_revisions r
    where r.id = v_revision_id;
end;
$$;

comment on function public.get_story_preview(uuid) is
  'Owner/linked-contributor (source-kind-partitioned, see this migration''s header)/assigned-editor/admin private preview. Returns no storage path of any kind for media -- only media_id and presentation fields.';

revoke execute on function public.get_story_preview(uuid) from public, anon, authenticated;
grant execute on function public.get_story_preview(uuid) to authenticated;

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

  -- Source-kind-partitioned owner/linked-contributor check, same rule as
  -- _is_story_owner() (see this migration's header comment).
  -- assigned_editor_id stays an unconditional third branch.
  return exists (
    select 1
    from public.stories s
    left join public.contributors c on c.id = s.contributor_id
    where s.id = v_media.story_id
      and s.current_draft_revision_id = v_media.reserved_for_revision_id
      and (
        (s.source_kind = 'self_submitted' and s.owner_user_id = auth.uid())
        or (s.source_kind = 'editorial_import' and c.linked_user_id = auth.uid())
        or s.assigned_editor_id = auth.uid()
      )
  );
end;
$$;

comment on function public._can_write_reserved_media_path(text) is
  'Storage RLS helper for the private bucket''s INSERT policy: strict path parsing, exact equality against a matching pending reservation, source-kind-partitioned owner/linked-contributor check plus an unconditional assigned-editor branch. No API grants (used only from within a storage policy).';

revoke execute on function public._can_write_reserved_media_path(text) from public, anon, authenticated;
