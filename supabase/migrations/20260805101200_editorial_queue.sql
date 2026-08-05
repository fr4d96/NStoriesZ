-- Prompt 6 Stage 1: a real editorial queue with filters/pagination,
-- covering awaiting-contributor-approval, changes-requested, the caller's
-- assigned stories, and (editor only) the unclaimed editorial_import pool.
--
-- list_assigned_editorial_stories() is NOT dropped -- grepped app/(editor)/
-- and confirmed app/(editor)/editorial/page.tsx still calls it directly
-- (lib/story/editorial-queries.ts#listAssignedEditorialStories()). This
-- migration adds a new, richer function alongside it rather than breaking
-- that existing call site; Stage 2 (out of scope here) can decide whether
-- to migrate that page to the new function.
--
-- Coverage, per the brief: awaiting_contributor_approval and
-- changes_requested (both are lifecycle_status filters, not exclusive to
-- "assigned to me" -- an editor/admin should be able to see them
-- regardless of assignment, since a story stuck in either state needs
-- editorial attention). Assigned-to-caller (any lifecycle_status). Unclaimed
-- pool (assigned_editor_id is null, source_kind = 'editorial_import') --
-- editor only, matching reassign_editorial_story()'s "claim an unassigned
-- story" rule from the sibling migration. Admin sees every editorial_import
-- story regardless of assignment.
--
-- p_search: simple ilike substring match on title (current draft/published
-- revision's title) or slug -- a small internal staff tool, no need for the
-- websearch_to_tsquery machinery list_published_stories() uses for public
-- search.

create function public.list_editorial_queue(
  p_status text default null,
  p_search text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  story_id uuid,
  slug text,
  title text,
  lifecycle_status public.story_lifecycle_status,
  version integer,
  assigned_editor_id uuid,
  contributor_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_is_admin boolean;
  v_limit integer;
  v_offset integer;
  v_search text;
begin
  v_is_admin := public.has_role(auth.uid(), 'admin');
  if not (public.has_role(auth.uid(), 'editor') or v_is_admin) then
    raise exception 'Only an editor or admin can read the editorial queue';
  end if;
  if p_status is not null and p_status not in (
    'draft', 'awaiting_contributor_approval', 'pending_review',
    'changes_requested', 'published', 'rejected', 'archived'
  ) then
    raise exception 'Unknown editorial queue status: %', p_status;
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 20), 50));
  v_offset := greatest(0, coalesce(p_offset, 0));
  v_search := nullif(trim(coalesce(p_search, '')), '');

  return query
    select
      s.id,
      s.slug,
      r.title,
      s.lifecycle_status,
      s.version,
      s.assigned_editor_id,
      s.contributor_id,
      s.created_at,
      s.updated_at,
      count(*) over ()
    from public.stories s
    left join public.story_revisions r
      on r.id = coalesce(s.current_draft_revision_id, s.published_revision_id)
    where s.source_kind = 'editorial_import'
      and (p_status is null or s.lifecycle_status::text = p_status)
      and (
        v_search is null
        or s.slug ilike ('%' || v_search || '%')
        or r.title ilike ('%' || v_search || '%')
      )
      and (
        v_is_admin
        or s.assigned_editor_id = auth.uid()
        or s.assigned_editor_id is null
      )
    order by s.updated_at desc, s.id asc
    limit v_limit offset v_offset;
end;
$$;

comment on function public.list_editorial_queue(text, text, integer, integer) is
  'Editor/admin only. Admin sees every editorial_import story; an editor sees stories assigned to them plus the unclaimed pool (assigned_editor_id is null), consistent with reassign_editorial_story()''s claim rule. p_search is a simple ilike substring match on title/slug. p_limit clamped to [1,50]. Does not replace list_assigned_editorial_stories(), which app/(editor)/editorial/page.tsx still calls directly.';

revoke execute on function public.list_editorial_queue(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.list_editorial_queue(text, text, integer, integer) to authenticated;
