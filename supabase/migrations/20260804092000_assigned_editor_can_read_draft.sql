-- Prompt 4 Sub-phase 4, bug fix: get_my_story_with_draft() authorized only
-- the story's owner/linked contributor (_is_story_owner()) -- never the
-- story's assigned_editor_id -- even though every actual write RPC that
-- touches a revision (_authorize_revision_edit(), save_revision_draft(),
-- create_next_draft_revision(), withdraw_unstarted_submission(), ...)
-- already grants the assigned editor edit rights. Net effect: an editor
-- assigned to an editorial-import story could write to it but could not
-- read it back through the one function the editorial edit page needs to
-- render a form -- confirmed by reading the function body directly before
-- writing this fix (Prompt 4 Sub-phase 4 plan, item 1).
--
-- Same output shape, same table signature -- CREATE OR REPLACE is
-- sufficient, no DROP needed.

create or replace function public.get_my_story_with_draft(p_story_id uuid)
returns table (
  story_id uuid, slug text, source_kind public.story_source_kind, visibility public.story_visibility,
  lifecycle_status public.story_lifecycle_status, version integer, assigned_editor_id uuid,
  revision_id uuid, revision_number integer, revision_status public.story_revision_status,
  title text, excerpt text, content_json jsonb, trip_start_date date, trip_end_date date,
  trip_year smallint, travel_style text, total_expense_nzd_cents integer, contributor_note text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (
    public._is_story_owner(p_story_id)
    or exists (
      select 1 from public.stories where id = p_story_id and assigned_editor_id = auth.uid()
    )
  ) then
    raise exception 'Not authorized to read story %', p_story_id;
  end if;
  return query
    select s.id, s.slug, s.source_kind, s.visibility, s.lifecycle_status, s.version, s.assigned_editor_id,
           r.id, r.revision_number, r.revision_status, r.title, r.excerpt, r.content_json,
           r.trip_start_date, r.trip_end_date, r.trip_year, r.travel_style, r.total_expense_nzd_cents,
           r.contributor_note
    from public.stories s
    left join public.story_revisions r
      on r.id = coalesce(s.current_draft_revision_id, s.published_revision_id)
    where s.id = p_story_id;
end;
$$;

comment on function public.get_my_story_with_draft(uuid) is
  'Owner/linked-contributor (via _is_story_owner) OR the story''s assigned editor. Fixed in Prompt 4 Sub-phase 4: previously excluded the assigned editor entirely, even though every write RPC already authorized them.';

-- Signature unchanged, so the existing revoke/grant pair from
-- 20260803090700_story_lifecycle_functions.sql already covers this
-- redefinition -- restated here for clarity/idempotency.
revoke execute on function public.get_my_story_with_draft(uuid) from public, anon, authenticated;
grant execute on function public.get_my_story_with_draft(uuid) to authenticated;
