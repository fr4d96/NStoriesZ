-- create_next_draft_revision() could not copy a contributor-authored tag or
-- work type, so starting a new draft on most published stories failed
-- outright with a check-constraint violation.
--
-- WHAT HAPPENED. 20260812110000_work_type_tag_custom_labels.sql added a
-- `custom_label` column to story_revision_tags and story_revision_work_types
-- (a row is EITHER a reference to a lookup row OR a free-text label the
-- contributor typed), enforced by
--   CHECK ((tag_id is not null and custom_label is null)
--       or (tag_id is null and custom_label is not null and ...))
-- It updated set_revision_tags()/set_revision_work_types() accordingly.
-- create_next_draft_revision() was rewritten three days later, in
-- 20260815110000, and kept copying only the id columns:
--   insert into story_revision_tags (revision_id, tag_id)
--   select v_new_revision_id, tag_id from ...
-- A custom-label row has tag_id = NULL, so it copied as (NULL, NULL) and
-- tripped `story_revision_tags_one_of` / `story_revision_work_types_one_of`.
-- The function raised, the whole transaction rolled back, and no draft was
-- created.
--
-- WHY NOBODY HIT IT UNTIL NOW. create_next_draft_revision() had no caller in
-- the application until 2026-09-02, when contributors were finally given an
-- "Edit" control on a published story. tests/integration/story-rls
-- .integration.test.ts exercises the function, but its fixtures only ever
-- attach lookup-row tags, never a typed one -- the exact case that breaks.
--
-- CONFIRMED EMPIRICALLY against the live dev project before writing this,
-- with an isolated rolled-back probe as the story's own owner:
--   23514 | new row for relation "story_revision_work_types" violates check
--           constraint "story_revision_work_types_one_of"
-- and the data behind it: 3 of 4 work-type rows are custom labels (all on
-- published stories), and 10 of 16 story_revision_tags rows across 7
-- revisions are custom labels. Since "add your own if you don't see it" is
-- how the tag editor is meant to be used, this was close to unconditional.
--
-- THE FIX is two columns in two inserts. Nothing else in the function
-- changes: the draft-pointer-before-child-copies ordering from 20260815110000
-- and the dangling-embed-token strip are reproduced here verbatim.
--
-- Work types are retired from authoring (20260816100100) but their rows are
-- deliberately never deleted, and get_published_story() still resolves them,
-- so they are copied faithfully rather than dropped -- a new draft must be a
-- true copy of what is published, not a quietly lossy one.

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

  -- custom_label, not just work_type_id -- see this migration's header.
  insert into public.story_revision_work_types (revision_id, work_type_id, custom_label)
  select v_new_revision_id, work_type_id, custom_label
  from public.story_revision_work_types where revision_id = v_source_revision_id;

  insert into public.story_revision_tags (revision_id, tag_id, custom_label)
  select v_new_revision_id, tag_id, custom_label
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
  'Starts the story''s next draft from its published (or latest terminal) revision. Copies contributor-authored tag/work-type labels as well as lookup references (fixed 20260902100000 -- copying only the id columns violated the *_one_of check constraints and made "edit a published story" fail outright). Sets the draft pointer BEFORE copying child rows, or _protect_revision_child_immutability() rejects every copy; and strips embed tokens whose image was not carried over, so the new draft never starts in the state save_revision_draft refuses.';

revoke execute on function public.create_next_draft_revision(uuid) from public, anon, authenticated;
grant execute on function public.create_next_draft_revision(uuid) to authenticated;
