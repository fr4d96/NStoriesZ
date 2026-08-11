-- Image embeds can now carry an optional stored display width, written by
-- the editor's drag-to-resize handle: `![[<mediaId>]]` or
-- `![[<mediaId>|<width>]]` (lib/story/markdown-media.ts). This migration
-- updates save_revision_draft's image-reference-integrity regex (last
-- touched in 20260811090000_markdown_content_json.sql) to tolerate the
-- optional `|<width>` suffix before the closing `]]` -- the guarantee is
-- unchanged: every embedded mediaId must already be attached to this
-- revision in story_revision_media (Engineering Rule 2/3 -- this SECURITY
-- DEFINER RPC, not the client-side Zod schema, is the non-bypassable
-- boundary). Without this, a resized image's content_json would fail to
-- match the old exact `![[uuid]]` pattern and its mediaId would silently
-- never be checked.
create or replace function public.save_revision_draft(
  p_revision_id uuid,
  p_expected_version integer,
  p_title text,
  p_excerpt text default null,
  p_content_json jsonb default '[]'::jsonb,
  p_trip_start_date date default null,
  p_trip_end_date date default null,
  p_trip_year smallint default null,
  p_travel_style text default null,
  p_total_expense_nzd_cents integer default null,
  p_contributor_note text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_story_id uuid;
  v_story public.stories;
  v_new_version integer;
  v_invalid_image_count integer;
  v_content_text text;
begin
  select story_id into v_story_id from public.story_revisions where id = p_revision_id;
  if v_story_id is null then
    raise exception 'No such revision: %', p_revision_id;
  end if;

  select * into v_story from public.stories where id = v_story_id for update;
  if v_story.version <> p_expected_version then
    raise exception 'Stale version for story % (expected %, got %)', v_story_id, v_story.version, p_expected_version;
  end if;

  if not coalesce(public._is_story_owner(v_story_id) or v_story.assigned_editor_id = auth.uid(), false) then
    raise exception 'Only the story owner or assigned editor can edit this revision';
  end if;
  if not public._revision_is_editable(p_revision_id) then
    raise exception 'Revision % is not currently editable', p_revision_id;
  end if;

  v_content_text := coalesce(p_content_json->0->>'text', '');

  begin
    select count(*) into v_invalid_image_count
    from (
      select (m[1])::uuid as media_id
      from regexp_matches(v_content_text, '!\[\[([0-9a-fA-F-]{36})(?:\|[0-9]{2,4})?\]\]', 'g') as m
    ) embedded
    where not exists (
      select 1
      from public.story_revision_media srm
      where srm.revision_id = p_revision_id
        and srm.media_id = embedded.media_id
    );
  exception when invalid_text_representation then
    raise exception 'Story content references an image with an invalid id';
  end;

  if v_invalid_image_count > 0 then
    raise exception 'Story content references an image that is not attached to this revision';
  end if;

  update public.story_revisions
  set title = p_title,
      excerpt = p_excerpt,
      content_json = coalesce(p_content_json, '[]'::jsonb),
      trip_start_date = p_trip_start_date,
      trip_end_date = p_trip_end_date,
      trip_year = p_trip_year,
      travel_style = p_travel_style,
      total_expense_nzd_cents = p_total_expense_nzd_cents,
      contributor_note = p_contributor_note,
      updated_by = auth.uid()
  where id = p_revision_id;

  update public.stories set version = version + 1 where id = v_story_id
    returning version into v_new_version;

  return v_new_version;
end;
$$;

comment on function public.save_revision_draft(
  uuid, integer, text, text, jsonb, date, date, smallint, text, integer, text
) is
  'Returns the authoritative new story.version (Prompt 4 Sub-phase 4). Extended in 20260812090000 to tolerate an optional |<width> suffix on ![[mediaId]] embed tokens (drag-to-resize) when extracting/validating referenced media ids -- see this migration''s header comment.';

revoke execute on function public.save_revision_draft(
  uuid, integer, text, text, jsonb, date, date, smallint, text, integer, text
) from public, anon, authenticated;
grant execute on function public.save_revision_draft(
  uuid, integer, text, text, jsonb, date, date, smallint, text, integer, text
) to authenticated;
