-- Internal helper functions shared by story-domain triggers and the
-- SECURITY DEFINER RPC functions defined later. Split into their own early
-- migration because the immutability triggers on child tables
-- (story_revision_relations.sql, story_media.sql) need _revision_is_editable
-- before the full RPC surface exists.
--
-- Every function here is prefixed `_` and gets an explicit
-- `revoke execute ... from public, anon, authenticated` with NO subsequent
-- grant — Postgres grants EXECUTE to PUBLIC on function creation by default,
-- so skipping this would silently make an "internal" helper callable over
-- the PostgREST API despite the naming convention. Only the function owner
-- and other SECURITY DEFINER functions/triggers running in that owner's
-- context can call these.

-- A story's "owner" for access-control purposes is either its
-- owner_user_id (self-service) OR the linked_user_id of its contributor
-- (a founding-catalogue import whose contributor has since linked an
-- account). owner_user_id can be null; this is the one place that OR logic
-- lives so it can't drift out of sync across functions.
create or replace function public._is_story_owner(p_story_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.stories s
    left join public.contributors c on c.id = s.contributor_id
    where s.id = p_story_id
      and (s.owner_user_id = auth.uid() or c.linked_user_id = auth.uid())
  );
$$;

comment on function public._is_story_owner(uuid) is
  'Internal: true if the caller is the story''s owner_user_id OR its linked contributor. No API grants.';

revoke execute on function public._is_story_owner(uuid) from public, anon, authenticated;

-- A revision is editable only when it is BOTH the story's current active
-- pointer AND still draft AND the story is in ordinary authoring
-- ('draft' = first-publication authoring, 'published' = replacement
-- authoring) — NOT while awaiting_contributor_approval (frozen for
-- contributor review) or any other lifecycle state.
create or replace function public._revision_is_editable(p_revision_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.story_revisions r
    join public.stories s on s.id = r.story_id
    where r.id = p_revision_id
      and s.current_draft_revision_id = p_revision_id
      and r.revision_status = 'draft'
      and s.lifecycle_status in ('draft', 'published')
  );
$$;

comment on function public._revision_is_editable(uuid) is
  'Internal: true only when the revision is the story''s active draft pointer, status = draft, and the story is in ordinary or replacement authoring (not awaiting contributor review). No API grants.';

revoke execute on function public._revision_is_editable(uuid) from public, anon, authenticated;
