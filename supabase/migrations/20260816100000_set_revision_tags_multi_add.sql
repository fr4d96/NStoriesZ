-- Tags become the platform's only story taxonomy (work types are removed
-- from every authoring/browse surface in the same change), and a
-- contributor may now add as many of their own tags as they like instead of
-- the single "Other (type your own)" value the edit form previously allowed.
--
-- The client is not the boundary (Engineering Rules 2/3): everything below
-- is enforced inside the SECURITY DEFINER RPC, so a hand-crafted request
-- gets the same limits the form does.
--
-- Three behaviours are added to set_revision_tags(); nothing is removed, and
-- the signature is unchanged, so every existing caller (the edit form's
-- setTagsAction, npm run test:rls) keeps working exactly as before:
--
--   1. Reuse over duplication. A typed label that case-insensitively matches
--      an existing `tags` row's name is stored as a reference to that row
--      rather than as a second, free-text copy of it -- otherwise "Van life"
--      and "van life" end up as two different tags on the same catalogue.
--      Contributors still cannot write to `tags` itself (that table stays
--      admin-only via RLS, per 20260803090000_lookup_tables.sql); a genuinely
--      new label is stored as this revision's own custom_label text, exactly
--      as before.
--   2. Dedupe. The same tag listed twice -- by id, or by two spellings of the
--      same custom label -- collapses to one row.
--   3. A per-revision cap of 20. Generous but not unbounded: it matches the
--      cap already applied to locations and to the selection arrays in
--      lib/validation/story.ts, and 20 topical labels on one story is well
--      past the point where tags describe a story rather than keyword-stuff
--      it. The 100-character length ceiling on a custom label is unchanged
--      (story_revision_tags_one_of's CHECK, added 20260812110000).
--
-- Deliberately NOT changed: set_revision_work_types() and every
-- p_work_type_id parameter. Published revisions still carry work-type rows,
-- the live RLS integration suite still exercises that RPC, and dropping
-- either would be irreversible. Work types simply stop being offered to
-- users.

create or replace function public.set_revision_tags(
  p_revision_id uuid, p_expected_version integer, p_tags jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_story_id uuid;
  v_version integer;
  v_count integer;
  v_max_tags constant integer := 20;
begin
  select public._authorize_revision_edit(p_revision_id) into v_story_id;
  select version into v_version from public.stories where id = v_story_id;
  if v_version <> p_expected_version then
    raise exception 'Stale version for story % (expected %, got %)', v_story_id, v_version, p_expected_version;
  end if;

  delete from public.story_revision_tags where revision_id = p_revision_id;

  insert into public.story_revision_tags (revision_id, tag_id, custom_label)
  with input as (
    select
      nullif(rec ->> 'tag_id', '')::uuid as tag_id,
      nullif(trim(rec ->> 'custom_label'), '') as custom_label
    from jsonb_array_elements(coalesce(p_tags, '[]'::jsonb)) as rec
  ),
  -- A custom label naming an existing lookup tag becomes a reference to it.
  -- An inactive lookup row still wins over inventing free text (an existing
  -- story may already reference it), but an active one is preferred.
  resolved as (
    select
      coalesce(i.tag_id, m.id) as tag_id,
      case when i.tag_id is null and m.id is null then i.custom_label end as custom_label
    from input i
    left join lateral (
      select tg.id
      from public.tags tg
      where i.tag_id is null
        and i.custom_label is not null
        and lower(tg.name) = lower(i.custom_label)
      order by tg.active desc, tg.created_at asc, tg.id asc
      limit 1
    ) m on true
  ),
  deduped as (
    select distinct on (coalesce(r.tag_id::text, lower(r.custom_label)))
      r.tag_id, r.custom_label
    from resolved r
    where r.tag_id is not null or r.custom_label is not null
    order by coalesce(r.tag_id::text, lower(r.custom_label))
  )
  select p_revision_id, d.tag_id, d.custom_label from deduped d;

  get diagnostics v_count = row_count;
  if v_count > v_max_tags then
    -- Inside the same transaction as the delete above, so raising here
    -- leaves the revision's existing tags untouched.
    raise exception 'Too many tags for revision % (max % per story, got %)',
      p_revision_id, v_max_tags, v_count;
  end if;

  update public.stories set version = version + 1 where id = v_story_id;
end;
$$;

comment on function public.set_revision_tags(uuid, integer, jsonb) is
  'Replaces a revision''s tag set. Same edit-rights rule and optimistic-version check as every other authoring RPC. Deduplicates case-insensitively, folds a typed label that names an existing lookup tag into a reference to that tag, and caps a revision at 20 tags -- the enforcing boundary, not the client.';

revoke execute on function public.set_revision_tags(uuid, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.set_revision_tags(uuid, integer, jsonb) to authenticated;
