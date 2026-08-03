-- Prompt 4 Sub-phase 3 gap found while building the authoring edit page:
-- story_revision_locations/story_revision_work_types/story_revision_tags
-- (supabase/migrations/20260803090300_story_revision_relations.sql) have
-- RLS enabled with NO policies at all — by design, every access is a
-- SECURITY DEFINER function — but only *writer* RPCs
-- (set_revision_locations/set_revision_work_types/set_revision_tags) were
-- ever built. There was no way for the owner's own edit form to read back
-- which locations/work types/tags are already selected on page load, which
-- would make every reload of the edit page silently forget the
-- contributor's prior selections. This migration adds the missing reader,
-- symmetric with the existing writers and using the exact same edit-rights
-- authorization rule as get_story_preview()/the writer RPCs themselves
-- (owner, linked contributor, assigned editor, or admin) — never a broader
-- relationship set.
--
-- NOT YET APPLIED to the linked hosted project as of writing — this file
-- is staged for review; do not run `supabase db push` without explicit
-- confirmation, per the standing project convention.

create or replace function public.get_revision_selections(p_revision_id uuid)
returns table (
  locations jsonb,
  work_type_ids uuid[],
  tag_ids uuid[]
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
          select array_agg(wt.work_type_id)
          from public.story_revision_work_types wt
          where wt.revision_id = p_revision_id
        ),
        '{}'::uuid[]
      ),
      coalesce(
        (
          select array_agg(t.tag_id)
          from public.story_revision_tags t
          where t.revision_id = p_revision_id
        ),
        '{}'::uuid[]
      );
end;
$$;

comment on function public.get_revision_selections(uuid) is
  'Reads back a revision''s selected locations/work types/tags for the authoring edit form. Same edit-rights rule as the writer RPCs (owner, linked contributor, assigned editor, admin) — never a broader set.';

revoke execute on function public.get_revision_selections(uuid) from public, anon, authenticated;
grant execute on function public.get_revision_selections(uuid) to authenticated;
