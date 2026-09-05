-- The two functions that must learn about story_revision_expenses
-- .custom_label (20260903110000), together because neither is useful alone.
--
-- get_revision_selections() read expenses through an INNER join on
-- expense_categories. With category_id now nullable that join would silently
-- DROP every contributor-typed row: the form would save the breakdown fine
-- and then render it empty on reload, with nothing raising anywhere.
--
-- create_next_draft_revision() copied only the id column, which for a typed
-- row means (null, null) and a story_revision_expenses_one_of violation --
-- so "edit a published story" would have failed outright, exactly as
-- 20260902100000 and 20260902110300 did. This is the FOURTH migration that
-- exists because a per-revision child table changed and an enumeration site
-- did not; the checklist inside the function names the new column now.

create or replace function public.get_revision_selections(p_revision_id uuid)
returns table (
  locations jsonb,
  work_types jsonb,
  tags jsonb,
  expenses jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_story_id uuid;
begin
  select story_id into v_story_id from public.story_revisions where id = p_revision_id;
  if v_story_id is null then
    raise exception 'No such revision: %', p_revision_id;
  end if;

  if not (
    public._is_story_owner(v_story_id)
    or exists (
      select 1 from public.stories s
      where s.id = v_story_id and s.assigned_editor_id = auth.uid()
    )
    or public.has_role(auth.uid(), 'admin')
  ) then
    raise exception 'Not authorized to read revision % selections', p_revision_id;
  end if;

  return query
    select
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'regionId', l.region_id,
              'destinationId', l.destination_id,
              'sortOrder', l.sort_order
            )
            order by l.sort_order
          )
          from public.story_revision_locations l
          where l.revision_id = p_revision_id
        ),
        '[]'::jsonb
      ),
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'workTypeId', wt.work_type_id,
              'customLabel', wt.custom_label
            )
          )
          from public.story_revision_work_types wt
          where wt.revision_id = p_revision_id
        ),
        '[]'::jsonb
      ),
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'tagId', t.tag_id,
              'customLabel', t.custom_label,
              'name', coalesce(tg.name, t.custom_label)
            )
            order by coalesce(tg.name, t.custom_label)
          )
          from public.story_revision_tags t
          left join public.tags tg on tg.id = t.tag_id
          where t.revision_id = p_revision_id
        ),
        '[]'::jsonb
      ),
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'categoryId', e.category_id,
              'slug', ec.slug,
              -- A typed row has no lookup row to resolve, so its own label
              -- IS its name. Without this the form renders a nameless row
              -- for every category a contributor wrote themselves.
              'name', coalesce(ec.name, e.custom_label),
              'customLabel', e.custom_label,
              'amountNzdCents', e.amount_nzd_cents,
              'note', e.note
            )
            -- Curated rows in their curated order, then typed ones
            -- alphabetically; nulls would otherwise sort unpredictably.
            order by coalesce(ec.sort_order, 2147483647),
                     coalesce(ec.name, e.custom_label)
          )
          from public.story_revision_expenses e
          -- LEFT join, not inner: 20260903110000 made category_id nullable,
          -- and an inner join here would silently DROP every
          -- contributor-typed row on read -- the breakdown would look like
          -- it had deleted itself on reload.
          left join public.expense_categories ec on ec.id = e.category_id
          where e.revision_id = p_revision_id
        ),
        '[]'::jsonb
      );
end;
$$;

comment on function public.get_revision_selections(uuid) is
  'Reads back a revision''s selected locations/work types/tags/expenses for the authoring edit form. Tags and expense categories carry their resolved display name so a retired (inactive) lookup row still renders. Same edit-rights rule as the writer RPCs (owner, linked contributor, assigned editor, admin) -- never a broader set.';

revoke execute on function public.get_revision_selections(uuid) from public, anon, authenticated;
grant execute on function public.get_revision_selections(uuid) to authenticated;


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

  -- CHILD-TABLE CHECKLIST. A new draft must be a true copy of what is
  -- published, not a quietly lossy one. Every table keyed off revision_id
  -- has to be copied below, with EVERY contributor-authored column, or the
  -- contributor loses that data the moment they click Edit:
  --   story_revision_locations  (region_id, destination_id, sort_order)
  --   story_revision_work_types (work_type_id, custom_label)
  --   story_revision_tags       (tag_id, custom_label)
  --   story_revision_media      (media_id, alt_text, caption, decorative,
  --                              sort_order, is_cover)
  --   story_revision_expenses   (category_id, custom_label, amount_nzd_cents, note)
  -- If you add a table to that list, add it here in the same change. Two
  -- migrations (20260902100000, and this one) exist only because that did
  -- not happen. All of these must come AFTER the draft-pointer update
  -- above, or _protect_revision_child_immutability() rejects every row.
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

  -- custom_label as well as category_id (20260903110000) -- an expense row
  -- is now EITHER a curated reference or a contributor-typed label, and
  -- copying only the id column would violate
  -- story_revision_expenses_one_of and make "edit a published story" fail
  -- outright. This is the fourth time this checklist has been the fix.
  insert into public.story_revision_expenses
    (revision_id, category_id, custom_label, amount_nzd_cents, note)
  select v_new_revision_id, category_id, custom_label, amount_nzd_cents, note
  from public.story_revision_expenses where revision_id = v_source_revision_id;

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
  'Starts the story''s next draft from its published (or latest terminal) revision. Copies EVERY per-revision child table -- locations, work types, tags, media and expenses -- including contributor-authored columns (custom labels, expense amounts/notes); the function body carries the checklist. Sets the draft pointer BEFORE copying child rows, or _protect_revision_child_immutability() rejects every copy; and strips embed tokens whose image was not carried over, so the new draft never starts in the state save_revision_draft refuses.';

revoke execute on function public.create_next_draft_revision(uuid) from public, anon, authenticated;
grant execute on function public.create_next_draft_revision(uuid) to authenticated;
