-- The story edit form now renders a revision's tags as removable chips
-- rather than as ticks against a fixed checkbox list, so it needs each tag's
-- display name, not just its id: a revision can legitimately reference a tag
-- that is no longer `active` (retired from new authoring but still carried
-- by existing stories), and such a tag is absent from the form's own
-- listActiveTags() options, so an id-only payload would render a nameless
-- chip.
--
-- Each element of the `tags` jsonb array gains a 'name' key -- the lookup
-- row's name for a reference, or the contributor's own text for a custom
-- label -- and the array is now ordered by that name so chip order is stable
-- across reloads. Everything else is byte-for-byte the live definition:
-- same signature, same RETURNS TABLE shape, same authorization rule (owner,
-- assigned editor, admin -- never broader), same work_types payload, which is
-- retained because published revisions still carry work-type rows even
-- though no UI reads them any more.

create or replace function public.get_revision_selections(p_revision_id uuid)
returns table (
  locations jsonb,
  work_types jsonb,
  tags jsonb
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
      );
end;
$$;

comment on function public.get_revision_selections(uuid) is
  'Reads back a revision''s selected locations/work types/tags for the authoring edit form. Tags carry their resolved display name so a retired (inactive) tag still renders. Same edit-rights rule as the writer RPCs (owner, linked contributor, assigned editor, admin) -- never a broader set.';

revoke execute on function public.get_revision_selections(uuid) from public, anon, authenticated;
grant execute on function public.get_revision_selections(uuid) to authenticated;
