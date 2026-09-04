-- get_revision_selections() gains an `expenses` column, so the story edit
-- form can load back a revision's saved expense breakdown the same way it
-- already loads back locations and tags. Without it the breakdown would
-- save fine and then vanish on the next page load.
--
-- Each element carries the category's id, its resolved name and slug, and
-- the amount in cents plus any note. The name comes from the join rather
-- than from the client's own category list for the same reason tags gained
-- one in 20260816100200: a category can be retired (`active = false`) while
-- existing stories still reference it, and a retired category is absent
-- from the form's listActiveExpenseCategories() options -- an id-only
-- payload would render a nameless row. Ordered by the lookup table's own
-- sort_order so the rows come back in the same trip order the editor
-- lists the categories in.
--
-- Everything else is byte-for-byte the live definition from
-- 20260816100200_get_revision_selections_tag_names.sql: same signature
-- apart from the added output column, same authorization rule (owner,
-- assigned editor, admin -- never broader), same locations/work_types/tags
-- payloads.
--
-- The return row shape changes (a new OUT column), which `create or
-- replace` cannot do, so DROP first -- same as 20260812100000 /
-- 20260829090000. The grants below are re-issued for the same reason: a
-- dropped function takes its EXECUTE privileges with it.
drop function if exists public.get_revision_selections(uuid);

create function public.get_revision_selections(p_revision_id uuid)
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
              'name', ec.name,
              'amountNzdCents', e.amount_nzd_cents,
              'note', e.note
            )
            order by ec.sort_order, ec.name
          )
          from public.story_revision_expenses e
          join public.expense_categories ec on ec.id = e.category_id
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
