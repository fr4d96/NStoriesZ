-- Prompt 4: private preview + private-media access authorization.
--
-- get_story_preview() returns NO storage path of any kind — anything a
-- SECURITY DEFINER function returns via the regular `authenticated` client
-- is visible to the browser over PostgREST, so a path can never be one of
-- its output columns. authorize_story_media_preview() is a separate,
-- authenticated, path-free "yes/no" check; the actual private path is only
-- ever looked up by get_media_private_path_for_preview(), granted
-- exclusively to service_role and called only from the one narrow module
-- that holds the admin client (lib/story/image-pipeline.ts) — the browser
-- only ever receives the final short-lived signed URL.
--
-- _can_access_story_media() is the shared authorization rule for both of
-- the above and the private Storage bucket's own RLS policy (next
-- migration): owner, linked contributor, assigned editor, or admin always;
-- a moderator only for media attached to a revision that is either
-- currently submitted (genuinely queued) or one they have already acted on
-- via moderation_actions — never a blanket grant merely from holding the
-- role.

create or replace function public._can_access_story_media(p_media_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_story_id uuid;
begin
  select story_id into v_story_id from public.story_media where id = p_media_id;
  if v_story_id is null then
    return false;
  end if;

  if public._is_story_owner(v_story_id) or public.has_role(auth.uid(), 'admin') then
    return true;
  end if;
  if exists (select 1 from public.stories where id = v_story_id and assigned_editor_id = auth.uid()) then
    return true;
  end if;

  if public.has_role(auth.uid(), 'moderator') then
    return exists (
      select 1
      from public.story_revision_media rm
      join public.story_revisions r on r.id = rm.revision_id
      where rm.media_id = p_media_id
        and (
          r.revision_status = 'submitted'
          or exists (select 1 from public.moderation_actions where revision_id = r.id and moderator_id = auth.uid())
        )
    );
  end if;

  return false;
end;
$$;

comment on function public._can_access_story_media(uuid) is
  'Internal: owner/linked-contributor/assigned-editor/admin always; a moderator only for media attached to a revision they are currently reviewing or have already decided on — never a blanket grant from the role alone. No API grants.';

revoke execute on function public._can_access_story_media(uuid) from public, anon, authenticated;

create or replace function public.authorize_story_media_preview(p_media_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public._can_access_story_media(p_media_id) then
    raise exception 'Not authorized to preview media %', p_media_id;
  end if;
end;
$$;

comment on function public.authorize_story_media_preview(uuid) is
  'Authenticated, authorize-only check with NO path-shaped output — calling it over PostgREST proves nothing to the client except yes/no. The actual private path is looked up separately, service_role only, by get_media_private_path_for_preview().';

revoke execute on function public.authorize_story_media_preview(uuid) from public, anon, authenticated;
grant execute on function public.authorize_story_media_preview(uuid) to authenticated;

create or replace function public.get_media_private_path_for_preview(p_media_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select processed_private_storage_path from public.story_media where id = p_media_id;
$$;

comment on function public.get_media_private_path_for_preview(uuid) is
  'Returns the private-bucket staging path for a media item''s processed derivative, with NO caller-identity check of its own — safe only because it is service_role-only and called exclusively from lib/story/image-pipeline.ts, after authorize_story_media_preview() has already been checked via the caller''s own regular client. The value this returns must never be forwarded to the browser directly — only the eventual signed URL is.';

revoke execute on function public.get_media_private_path_for_preview(uuid) from public, anon, authenticated;
grant execute on function public.get_media_private_path_for_preview(uuid) to service_role;

-- get_story_preview(): owner, linked contributor, assigned editor, or admin
-- — structurally excludes story_revision_editor_notes and
-- moderation_action_notes (no column, no join to either exists in this
-- function's body at all). Used by /stories/[id]/preview exclusively; never
-- the anonymous/public get_published_story family, which is wrong for
-- unpublished content, and never get_story_for_editor/get_story_for_moderator,
-- which carry staff-only material this function must never expose.
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

  if v_story.owner_user_id = auth.uid() then
    v_relationship := 'owner';
  elsif v_contributor.linked_user_id = auth.uid() then
    v_relationship := 'linked_contributor';
  elsif v_story.assigned_editor_id = auth.uid() then
    v_relationship := 'assigned_editor';
  elsif public.has_role(auth.uid(), 'admin') then
    v_relationship := 'admin';
  else
    raise exception 'Not authorized to preview story %', p_story_id;
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
  'Owner/linked-contributor/assigned-editor/admin private preview. Returns no storage path of any kind for media — only media_id and presentation fields; callers mint a signed URL separately via authorize_story_media_preview() + a narrow server-only path lookup.';

revoke execute on function public.get_story_preview(uuid) from public, anon, authenticated;
grant execute on function public.get_story_preview(uuid) to authenticated;
