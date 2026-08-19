-- delete_draft_story(): lets a contributor permanently remove a story they
-- started but never went anywhere with (e.g. an accidental "Untitled
-- story" or an abandoned draft) from their own My Stories list.
--
-- Deliberately scoped as narrowly as the schema's immutability guarantees
-- allow, rather than a general "delete any story" function:
--
--   - lifecycle_status must be 'draft' and published_revision_id must be
--     null -- this story has never been publicly visible, so deleting it
--     can never violate Engineering Rules 10-12 (nothing public to
--     un-publish) or destroy a moderator's/editor's decision history.
--   - The story must have exactly ONE revision, and that revision must
--     still be revision_status = 'draft' -- i.e. it was never submitted,
--     reviewed, rejected, or sent back for changes. This is not an
--     arbitrary restriction: story_revision_locations/work_types/tags/media
--     all carry a `_protect_revision_child_immutability` trigger that
--     refuses to touch child rows of any revision `_revision_is_editable()`
--     doesn't currently consider editable (i.e. anything but the live
--     draft) -- a story with prior terminal revisions (rejected /
--     changes_requested / withdrawn / superseded) has real reviewed history
--     that this function will not attempt to force through those triggers.
--     A contributor who wants to abandon a story with that kind of history
--     already has archive_story() (moderator/admin) or can simply stop
--     working on it; this function is for the "never went anywhere" case.
--
-- Deletion order respects every `on delete restrict` FK in the domain
-- (see docs/architecture.md "Story domain access model"): child rows of
-- the single draft revision first, then story_media (this story's images
-- -- same unconditional `delete from story_media` cancel_pending_story_
-- media_upload() already uses for an unattached reservation), then the
-- stories.current_draft_revision_id pointer is nulled (required before the
-- revision row itself can be deleted), then the revision, then the story.
-- Storage objects for any deleted story_media rows are intentionally left
-- in place -- private-bucket bytes with no live DB row are orphaned, never
-- exposed (Engineering Rule 13), the same accepted cost every rollback path
-- in lib/story/pdf-page-attachment.ts already carries.
--
-- If any of this story's rows turn out to be referenced from a table this
-- function does not touch (moderation_actions, story_reports,
-- story_publication_consents, etc. -- none of which should be reachable
-- given the checks above), the DELETE FROM stories at the end fails on
-- that table's own `on delete restrict` FK with a clear error, rather than
-- silently cascading through audit/moderation history. That failure is the
-- intended behavior, not a bug to work around.
create or replace function public.delete_draft_story(p_story_id uuid, p_expected_version integer)
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

  delete from public.story_revision_media where revision_id = v_revision.id;
  delete from public.story_media where story_id = p_story_id;
  delete from public.story_revision_locations where revision_id = v_revision.id;
  delete from public.story_revision_work_types where revision_id = v_revision.id;
  delete from public.story_revision_tags where revision_id = v_revision.id;

  update public.stories set current_draft_revision_id = null where id = p_story_id;
  delete from public.story_revisions where id = v_revision.id;
  delete from public.stories where id = p_story_id;
end;
$$;

comment on function public.delete_draft_story(uuid, integer) is
  'Permanently deletes a self-service story that has never left plain-draft status (no submission, no review history, never published). See this migration''s header comment for why the scope is this narrow.';

revoke execute on function public.delete_draft_story(uuid, integer) from public, anon, authenticated;
grant execute on function public.delete_draft_story(uuid, integer) to authenticated;
