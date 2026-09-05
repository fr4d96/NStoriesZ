-- My Stories needs to know, per row, whether a takedown request is awaiting
-- review -- otherwise the contributor clicks "Request takedown" a second
-- time and gets an exception where a disabled control and an "awaiting
-- review" badge belonged.
--
-- WHY A BATCH RPC AND NOT get_my_takedown_request() PER ROW. My Stories was
-- explicitly de-N+1'd (see 20260829090000 / 20260831090000 and the
-- "one RPC per page, not one preview call per story" work): calling a
-- per-story function once per row would put the N+1 straight back, on a page
-- that renders twelve stories at a time. One call returns every open request
-- the caller owns.
--
-- Scoped by ownership inside the function, exactly like list_my_stories():
-- it takes no user parameter at all, so there is no client-supplied id to
-- forge (Engineering Rule 2).

create or replace function public.list_my_takedown_requests()
returns table (
  request_id uuid,
  story_id uuid,
  status text,
  requested_at timestamptz,
  decided_at timestamptz,
  decision_note text
)
language sql
stable
security definer
set search_path = ''
as $$
  -- distinct on (story_id) with the matching order by: the most recent
  -- request per story, so a re-request after a decline supersedes the
  -- decline rather than both appearing.
  select distinct on (r.story_id)
    r.id, r.story_id, r.status, r.requested_at, r.decided_at, r.decision_note
  from public.story_takedown_requests r
  join public.stories s on s.id = r.story_id
  left join public.contributors c on c.id = s.contributor_id
  where s.owner_user_id = auth.uid() or c.linked_user_id = auth.uid()
  order by r.story_id, r.requested_at desc;
$$;

comment on function public.list_my_takedown_requests() is
  'The caller''s own stories'' most recent takedown request, one row per story. Ownership is derived from auth.uid() inside the function -- no user parameter to forge. Batch by design: My Stories renders twelve rows a page and must not go back to one call per story.';

revoke execute on function public.list_my_takedown_requests()
  from public, anon, authenticated;
grant execute on function public.list_my_takedown_requests() to authenticated;
