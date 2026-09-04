-- delete_draft_story() could not delete a draft that had an expense
-- breakdown, and failed silently doing it.
--
-- WHAT HAPPENED. 20260902110100 added story_revision_expenses with
-- `revision_id references story_revisions(id) on delete restrict` -- the
-- same restrict every other per-revision child table carries. But
-- delete_draft_story() clears its child tables by NAME, one delete per
-- table, and the new one was not added to that list. So the function
-- deleted media/locations/work types/tags, then hit
--   delete from public.story_revisions where id = v_revision.id;
-- which the surviving expense rows refused, the exception rolled the whole
-- transaction back, and the story stayed exactly where it was.
--
-- CONFIRMED EMPIRICALLY, not reasoned about: a real draft with three
-- expense rows would not delete through the UI -- the dialog closed and the
-- story was still listed, and still present in the database afterwards.
--
-- THIS IS THE SECOND TIME. 20260902100000 and 20260902110300 both exist
-- because a per-revision child table was added without updating a function
-- that enumerates them, and 20260902110300 put a checklist inside
-- create_next_draft_revision() for exactly that reason. It was the wrong
-- place for it: create_next_draft_revision() is not the only function that
-- enumerates these tables, and writing the checklist there is what made it
-- easy to miss this one. The checklist now names both sites, in both
-- functions.
--
-- Nothing else in the function changes. Only the delete list gains a line,
-- placed with the other child-row deletes and therefore before the
-- story_revisions delete they exist to unblock.
--
-- Read functions (get_published_story, get_story_for_moderator,
-- get_moderation_queue, list_published_stories,
-- get_content_readiness_queue) also predate story_revision_expenses and are
-- deliberately NOT touched here: none of them is blocked by it, and
-- surfacing the breakdown publicly or in moderation is scoped work that has
-- not been asked for yet.

create or replace function public.delete_draft_story(
  p_story_id uuid, p_expected_version integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_story public.stories;
  v_revision_count integer;
  v_revision public.story_revisions;
begin
  select * into v_story from public.stories where id = p_story_id for update;
  if not found then
    raise exception 'No such story: %', p_story_id;
  end if;
  if not public._is_story_owner(p_story_id) then
    raise exception 'Only the story owner can delete this story';
  end if;
  if v_story.version <> p_expected_version then
    raise exception 'Stale version for story % (expected %, got %)', p_story_id, v_story.version, p_expected_version;
  end if;

  if v_story.lifecycle_status <> 'draft' or v_story.published_revision_id is not null then
    raise exception 'Only a never-published draft story can be deleted (story %)', p_story_id;
  end if;
  if v_story.current_draft_revision_id is null then
    raise exception 'Story % has no draft revision to delete', p_story_id;
  end if;

  select * into v_revision from public.story_revisions
    where id = v_story.current_draft_revision_id for update;
  if v_revision.revision_status <> 'draft' then
    raise exception 'Story % is not currently in a plain-draft state', p_story_id;
  end if;

  select count(*) into v_revision_count
  from public.story_revisions where story_id = p_story_id;
  if v_revision_count <> 1 then
    raise exception
      'Story % has prior reviewed revision history and cannot be deleted this way', p_story_id;
  end if;

  -- CHILD-TABLE CHECKLIST (site 2 of 2 -- the other is
  -- create_next_draft_revision, which COPIES the same list). Every table
  -- keyed off revision_id has `on delete restrict`, so each one must be
  -- cleared here before the story_revisions delete below or that delete
  -- raises and the whole deletion silently rolls back:
  --   story_revision_media
  --   story_media            (keyed off story_id, not revision_id)
  --   story_revision_locations
  --   story_revision_work_types
  --   story_revision_tags
  --   story_revision_expenses
  -- Adding a per-revision table means editing BOTH sites in the same
  -- change. Three migrations now exist only because that did not happen.
  delete from public.story_revision_media where revision_id = v_revision.id;
  delete from public.story_media where story_id = p_story_id;
  delete from public.story_revision_locations where revision_id = v_revision.id;
  delete from public.story_revision_work_types where revision_id = v_revision.id;
  delete from public.story_revision_tags where revision_id = v_revision.id;
  delete from public.story_revision_expenses where revision_id = v_revision.id;

  update public.stories set current_draft_revision_id = null where id = p_story_id;
  delete from public.story_revisions where id = v_revision.id;
  delete from public.stories where id = p_story_id;
end;
$$;

comment on function public.delete_draft_story(uuid, integer) is
  'Hard-deletes a never-published draft story and every per-revision child row it owns. The function body carries the child-table checklist; it is one of TWO sites that enumerate those tables (create_next_draft_revision copies the same list), and both must be updated together when a new one is added -- every child FK is `on delete restrict`, so a missed table makes this fail and roll back silently rather than loudly.';

revoke execute on function public.delete_draft_story(uuid, integer) from public, anon, authenticated;
grant execute on function public.delete_draft_story(uuid, integer) to authenticated;
