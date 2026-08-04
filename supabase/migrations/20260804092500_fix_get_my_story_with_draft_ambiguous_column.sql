-- Bug fix, found via live test:rls run immediately after pushing Prompt 4
-- Sub-phase 4's migrations: 20260804092000_assigned_editor_can_read_draft.sql
-- introduced `exists (select 1 from public.stories where id = p_story_id and
-- assigned_editor_id = auth.uid())` with no table alias. Since this
-- function's own RETURNS TABLE also declares an output column named
-- `assigned_editor_id`, that bare reference is ambiguous -- Postgres cannot
-- tell whether it means the table column or the implicit PL/pgSQL output
-- variable of the same name. This is the exact same bug class already
-- documented and fixed for three other functions in
-- 20260803091000_fix_returns_table_column_ambiguity.sql; this migration
-- applies the same fix (qualify with a table alias) to this new instance of
-- it. Confirmed live: `select ... from public.stories where id = p_story_id`
-- returned `42702 column reference "assigned_editor_id" is ambiguous` when
-- exercised for real via the RLS integration suite.
--
-- Same output shape, same signature -- CREATE OR REPLACE is sufficient.

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
      select 1 from public.stories s where s.id = p_story_id and s.assigned_editor_id = auth.uid()
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
  'Owner/linked-contributor (via _is_story_owner) OR the story''s assigned editor. Fixed in 20260804092000 to include the assigned editor; fixed again here (20260804092500) for an ambiguous-column-reference bug that fix introduced.';

revoke execute on function public.get_my_story_with_draft(uuid) from public, anon, authenticated;
grant execute on function public.get_my_story_with_draft(uuid) to authenticated;
