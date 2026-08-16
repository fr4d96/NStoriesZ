-- Two fixes to create_next_draft_revision(), both needed before anyone can
-- start a new draft on an already-published story that has images.
--
-- 1. THE CHILD-ROW COPY COULD NEVER HAVE WORKED. The function copies the
--    source revision's locations, work types, tags, and media into the new
--    revision, and only THEN points stories.current_draft_revision_id at it.
--    But every one of those child tables carries
--    _protect_revision_child_immutability(), which raises unless
--    _revision_is_editable(revision) -- and that helper requires
--    `s.current_draft_revision_id = p_revision_id`, which is still null at
--    that moment. So every child insert raised
--    "Cannot modify child rows of a revision that is not currently editable",
--    i.e. "Edit" on any published story carrying a location, work type, tag,
--    or image failed outright. Confirmed empirically against the live project
--    before writing this migration (an isolated, rolled-back probe insert
--    reproduced the exact exception).
--    Fixed by setting the draft pointer immediately after the new revision
--    row is inserted and BEFORE the child copies. Nothing is weakened: the
--    trigger still demands the row be the story's active draft in draft
--    status, and it now genuinely is from the moment it exists -- which is
--    the truth the ordering was misrepresenting. The version bump still
--    happens exactly once.
--
-- 2. A DANGLING IMAGE REFERENCE WOULD POISON THE NEW DRAFT. content_json is
--    copied verbatim, and the media rows are copied as they are. If the
--    source content embeds a `![[mediaId]]` token whose media is NOT attached
--    (the state 20260815100000 stopped detach_story_media from creating, but
--    which already exists in rows written before it), the new draft starts in
--    exactly the state save_revision_draft refuses to accept -- so every
--    autosave in that draft would fail with "Story content references an
--    image that is not attached to this revision", and the author would have
--    no way to fix it, since the offending token is invisible in the editor
--    (it renders as the image itself).
--    Fixed by stripping, from the NEW revision's copied content only, every
--    embed token whose media id was not carried over. The published revision
--    is never touched; this only cleans the draft being created.
create or replace function public.create_next_draft_revision(p_story_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_story public.stories;
  v_candidate record;
  v_published_number integer;
  v_source_revision_id uuid;
  v_new_revision_id uuid;
  v_next_number integer;
  v_content_text text;
  v_stripped text;
  v_embedded_id text;
begin
  select * into v_story from public.stories where id = p_story_id for update;
  if not found then
    raise exception 'No such story: %', p_story_id;
  end if;
  if not coalesce(public._is_story_owner(p_story_id) or v_story.assigned_editor_id = auth.uid(), false) then
    raise exception 'Only the story owner or assigned editor can start a new draft revision';
  end if;
  if v_story.current_draft_revision_id is not null then
    raise exception 'Story % already has an active draft/replacement revision', p_story_id;
  end if;
  if v_story.lifecycle_status = 'archived' then
    raise exception 'Cannot create a new revision for an archived story';
  end if;

  select id, revision_number into v_candidate
  from public.story_revisions
  where story_id = p_story_id and revision_status in ('rejected', 'changes_requested', 'withdrawn')
  order by revision_number desc limit 1;

  if v_story.published_revision_id is null then
    if v_candidate.id is null then
      raise exception 'Story % has no prior terminal revision to base a new draft on', p_story_id;
    end if;
    v_source_revision_id := v_candidate.id;
  else
    select revision_number into v_published_number
    from public.story_revisions where id = v_story.published_revision_id;
    if v_candidate.id is not null and v_candidate.revision_number > v_published_number then
      v_source_revision_id := v_candidate.id;
    else
      v_source_revision_id := v_story.published_revision_id;
    end if;
  end if;

  select coalesce(max(revision_number), 0) + 1 into v_next_number
  from public.story_revisions where story_id = p_story_id;

  insert into public.story_revisions (
    story_id, revision_number, title, excerpt, content_json, trip_start_date, trip_end_date,
    trip_year, travel_style, total_expense_nzd_cents, contributor_note, created_by, updated_by
  )
  select
    p_story_id, v_next_number, title, excerpt, content_json, trip_start_date, trip_end_date,
    trip_year, travel_style, total_expense_nzd_cents, contributor_note, auth.uid(), auth.uid()
  from public.story_revisions where id = v_source_revision_id
  returning id into v_new_revision_id;

  -- Fix 1: the new revision becomes the story's active draft BEFORE its
  -- child rows are copied, so _protect_revision_child_immutability() sees an
  -- editable revision (which it is) rather than an orphan.
  update public.stories set current_draft_revision_id = v_new_revision_id, version = version + 1
    where id = p_story_id;

  insert into public.story_revision_locations (revision_id, region_id, destination_id, sort_order)
  select v_new_revision_id, region_id, destination_id, sort_order
  from public.story_revision_locations where revision_id = v_source_revision_id;

  insert into public.story_revision_work_types (revision_id, work_type_id)
  select v_new_revision_id, work_type_id
  from public.story_revision_work_types where revision_id = v_source_revision_id;

  insert into public.story_revision_tags (revision_id, tag_id)
  select v_new_revision_id, tag_id
  from public.story_revision_tags where revision_id = v_source_revision_id;

  insert into public.story_revision_media (revision_id, media_id, alt_text, caption, decorative, sort_order, is_cover)
  select v_new_revision_id, media_id, alt_text, caption, decorative, sort_order, is_cover
  from public.story_revision_media where revision_id = v_source_revision_id;

  -- Fix 2: drop any embed token in the copied content whose image did not
  -- come with it, so the new draft satisfies save_revision_draft's
  -- reference-integrity check from its very first autosave.
  select content_json->0->>'text' into v_content_text
  from public.story_revisions where id = v_new_revision_id;

  if v_content_text is not null then
    v_stripped := v_content_text;
    for v_embedded_id in
      select distinct lower(m[1])
      from regexp_matches(
        v_content_text,
        '!\[\[([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(\|[0-9]{2,4})?\]\]',
        'g'
      ) as m
    loop
      if not exists (
        select 1 from public.story_revision_media
        where revision_id = v_new_revision_id and media_id::text = v_embedded_id
      ) then
        v_stripped := regexp_replace(
          v_stripped,
          '!\[\[' || v_embedded_id || '(\|[0-9]{2,4})?\]\]',
          '',
          'gi'
        );
      end if;
    end loop;

    if v_stripped <> v_content_text then
      update public.story_revisions
      set content_json = jsonb_set(content_json, '{0,text}', to_jsonb(v_stripped))
      where id = v_new_revision_id;
    end if;
  end if;

  if v_story.lifecycle_status in ('rejected', 'changes_requested', 'draft') then
    update public.stories set lifecycle_status = 'draft' where id = p_story_id;
  end if;

  return v_new_revision_id;
end;
$$;

comment on function public.create_next_draft_revision(uuid) is
  'Starts the story''s next draft from its published (or latest terminal) revision. Sets the draft pointer BEFORE copying child rows, or _protect_revision_child_immutability() rejects every copy; and strips embed tokens whose image was not carried over, so the new draft never starts in the state save_revision_draft refuses. See supabase/migrations/20260815110000_fix_create_next_draft_revision.sql.';

revoke execute on function public.create_next_draft_revision(uuid) from public, anon, authenticated;
grant execute on function public.create_next_draft_revision(uuid) to authenticated;
