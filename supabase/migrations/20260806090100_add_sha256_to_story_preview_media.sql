-- Prompt 7: get_story_preview()'s media jsonb gains a 'sha256' key, so the
-- editorial UI can warn about same-story duplicate image uploads (comparing
-- hashes it already legitimately has access to, client-side) without
-- exposing anything new -- sha256 is a hash of the already-processed,
-- already-metadata-stripped public derivative, not a storage path or any
-- other sensitive value. create or replace is sufficient (the RETURNS TABLE
-- shape is unchanged -- media stays a single jsonb column, only its internal
-- object shape gains one key), unlike the DROP+CREATE this codebase needs
-- when a function's own returns-table column list changes.
--
-- Diffed against the CURRENT live body (20260804092200_source_kind_partitioned_authorization.sql,
-- the most recent migration to touch this function) before making this
-- change, per this codebase's own "reconstruct from the live body, not a
-- stale copy" lesson (documented repeatedly, e.g. docs/architecture.md's
-- "Story domain" section) -- the only change below is the added
-- 'sha256', m.sha256 pair inside jsonb_build_object.

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
              'processingState', m.processing_state,
              'sha256', m.sha256
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
  'Owner/linked-contributor (source-kind-partitioned, see the migration that introduced this partition)/assigned-editor/admin private preview. Returns no storage path of any kind for media -- only media_id, presentation fields, and sha256 (a hash of the processed derivative, added Prompt 7, used for same-story duplicate-image warnings).';

revoke execute on function public.get_story_preview(uuid) from public, anon, authenticated;
grant execute on function public.get_story_preview(uuid) to authenticated;
