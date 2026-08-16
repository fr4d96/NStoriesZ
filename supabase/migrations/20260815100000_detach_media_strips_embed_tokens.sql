-- detach_story_media() removed the story_revision_media join row but left
-- any `![[<mediaId>]]` / `![[<mediaId>|<width>]]` embed token for that image
-- sitting in the revision's Markdown (content_json[0].text). That produced a
-- dangling reference with no way back:
--
--   * save_revision_draft() (20260812090000) rejects content referencing a
--     mediaId not attached to the revision -- but only on the way IN. It had
--     no counterpart on the way OUT, so detaching created exactly the state
--     saving is forbidden to create, and every later save of that draft then
--     failed with "references an image that is not attached to this revision".
--   * The editor still renders the orphaned token: it resolves an embed by
--     minting a private-bucket preview URL for the mediaId
--     (authorize_story_media_preview), which is scoped to the story, not to
--     the revision's media list -- so the image looks present while writing.
--   * get_published_story_media() (20260803090800) only ever returns
--     ATTACHED, promoted media, so the published page renders nothing where
--     that image was: an image visible in the editor, silently missing from
--     the approved, published story.
--
-- Detaching now strips the image's embed tokens from the same revision's
-- content in the same transaction, so content and attachments can never
-- diverge in the first place. The write is deliberately confined to removing
-- that one image's tokens -- no other content edit -- and reuses the exact
-- token shape save_revision_draft validates against.
--
-- Immutability is respected, not bypassed: _authorize_revision_edit() (which
-- already gates this function) is what decides whether this revision may be
-- written at all, and it is unchanged here. A published/approved revision is
-- not detachable in the first place, so this can never rewrite what is
-- publicly visible (Engineering Rules 10-12).
create or replace function public.detach_story_media(
  p_revision_id uuid, p_expected_version integer, p_media_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_story_id uuid;
  v_version integer;
  v_content_text text;
  v_stripped text;
begin
  select public._authorize_revision_edit(p_revision_id) into v_story_id;
  select version into v_version from public.stories where id = v_story_id;
  if v_version <> p_expected_version then
    raise exception 'Stale version for story % (expected %, got %)', v_story_id, v_version, p_expected_version;
  end if;

  delete from public.story_revision_media where revision_id = p_revision_id and media_id = p_media_id;

  -- Strip this image's embed tokens from the revision's Markdown, if any.
  -- Same token grammar as save_revision_draft's integrity check: the id,
  -- optionally followed by |<width>.
  select content_json->0->>'text' into v_content_text
  from public.story_revisions where id = p_revision_id;

  if v_content_text is not null then
    v_stripped := regexp_replace(
      v_content_text,
      '!\[\[' || p_media_id::text || '(\|[0-9]{2,4})?\]\]',
      '',
      'gi'
    );
    if v_stripped <> v_content_text then
      update public.story_revisions
      set content_json = jsonb_set(content_json, '{0,text}', to_jsonb(v_stripped)),
          updated_by = auth.uid()
      where id = p_revision_id;
    end if;
  end if;

  update public.stories set version = version + 1 where id = v_story_id;
end;
$$;

comment on function public.detach_story_media(uuid, integer, uuid) is
  'Detaches an image from a revision AND strips its ![[mediaId]] embed tokens from that revision''s Markdown content in the same transaction, so content can never reference media the revision no longer carries -- the counterpart to save_revision_draft''s inbound reference-integrity check. See this migration''s header comment.';

revoke execute on function public.detach_story_media(uuid, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.detach_story_media(uuid, integer, uuid) to authenticated;
