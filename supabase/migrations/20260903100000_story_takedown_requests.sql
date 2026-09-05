-- Contributor takedown becomes a REQUEST that a moderator decides, rather
-- than something the contributor does directly.
--
-- WHAT CHANGES, AND THE TRADE-OFF BEING ACCEPTED. Until now
-- revoke_publication_consent() let the story's owner remove their own story
-- from public view immediately. That is the strongest possible consent
-- story: the moment someone withdraws, they are withdrawn. The product
-- decision recorded here is different -- a contributor asks, and a moderator
-- approves -- which necessarily means a story stays PUBLICLY VISIBLE for
-- some window after its own author has asked for it to come down. That
-- window is a real cost, not a technicality: it should be covered by an
-- operational response-time commitment, and the contributor-facing UI should
-- say how long review takes rather than leaving them guessing.
--
-- WHY THE OWNER PATH IS CLOSED, NOT JUST HIDDEN. Requiring approval is
-- meaningless if the underlying RPC still accepts the owner: every RPC here
-- is granted to `authenticated` and reachable over PostgREST, so leaving the
-- owner branch in place would make the new flow a suggestion that any
-- hand-crafted request could skip. revoke_publication_consent() is therefore
-- narrowed to admin-only (Engineering Rules 2/3: the database is where this
-- is decided, not the UI).
--
-- WHY ONE SHARED HELPER. Approving a request and an admin acting directly
-- must produce byte-identical state -- same terminalization, same
-- consent_revoked_at, same audit row. Two copies of that logic would drift,
-- which is the exact failure mode that produced three corrective migrations
-- in this repo already (see 20260903090000's header). Both paths call
-- _apply_consent_withdrawal().

-- 1. The audit trail learns the new action types --------------------------

alter table public.story_publication_state_actions
  drop constraint story_publication_state_actions_action_type_check;

alter table public.story_publication_state_actions
  add constraint story_publication_state_actions_action_type_check check (
    action_type in (
      'archived',
      'consent_withdrawn',
      'takedown_requested',
      'takedown_declined',
      'takedown_cancelled'
    )
  );

-- The existing "archived rows need a reason" invariant is unchanged, and
-- deliberately still does NOT apply to the new types: a contributor asking
-- for their own story to come down is not asked to justify it, and a
-- moderator's decline note is optional prose rather than a required reason.

-- 2. The request itself ---------------------------------------------------

create table public.story_takedown_requests (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.stories (id) on delete restrict,
  requested_by uuid references auth.users (id) on delete set null,
  requested_at timestamptz not null default now(),
  -- Optional, and framed as context for the moderator rather than a
  -- justification the contributor owes anyone.
  contributor_note text,
  status text not null default 'pending',
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  constraint story_takedown_requests_status_check check (
    status in ('pending', 'approved', 'declined', 'cancelled')
  ),
  constraint story_takedown_requests_contributor_note_length check (
    contributor_note is null or char_length(contributor_note) <= 2000
  ),
  constraint story_takedown_requests_decision_note_length check (
    decision_note is null or char_length(decision_note) <= 2000
  ),
  -- A pending row has not been decided; a decided row records when. Enforced
  -- structurally so no future function can leave a half-decided row behind.
  constraint story_takedown_requests_decided_fields check (
    (status = 'pending' and decided_at is null and decided_by is null)
    or (status <> 'pending' and decided_at is not null)
  )
);

-- At most one OPEN request per story. A partial unique index rather than a
-- plain one, so a story can be requested again after a decline (people
-- change their minds, and a declined request must not lock the story out of
-- the queue forever).
create unique index story_takedown_requests_one_pending
  on public.story_takedown_requests (story_id)
  where status = 'pending';

create index story_takedown_requests_story_id_idx
  on public.story_takedown_requests (story_id);
create index story_takedown_requests_pending_idx
  on public.story_takedown_requests (requested_at)
  where status = 'pending';

comment on table public.story_takedown_requests is
  'A contributor''s request to have their own published story taken off the site, and the moderator decision on it. At most one pending row per story. No direct API grants -- written only by request_story_takedown()/decide_story_takedown()/cancel_story_takedown_request().';

alter table public.story_takedown_requests enable row level security;
-- No policies -- every access is a SECURITY DEFINER function, matching the
-- story domain's convention.
revoke all on public.story_takedown_requests from public, anon, authenticated;

-- 3. The shared state change ----------------------------------------------

-- Internal: the actual withdrawal, with NO authorization of its own. Every
-- caller must have decided the caller is allowed BEFORE calling this.
-- Prefixed `_` and never granted, per story_internal_helpers.sql's
-- convention -- Postgres grants EXECUTE to PUBLIC on creation, so skipping
-- the revoke would quietly publish an unauthenticated withdrawal primitive.
create or replace function public._apply_consent_withdrawal(
  p_story_id uuid, p_actor uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_story public.stories;
begin
  select * into v_story from public.stories where id = p_story_id for update;
  if not found then
    raise exception 'No such story: %', p_story_id;
  end if;
  if v_story.consent_revoked_at is not null then
    raise exception 'Consent for story % has already been revoked', p_story_id;
  end if;

  perform public._terminalize_active_revision(p_story_id);

  update public.stories
    set consent_revoked_at = now(),
        consent_revoked_by = p_actor,
        lifecycle_status = case when lifecycle_status = 'published'
                                then 'archived'::public.story_lifecycle_status
                                else lifecycle_status end,
        archived_at = case when lifecycle_status = 'published' then now() else archived_at end,
        version = version + 1
    where id = p_story_id;

  insert into public.story_publication_state_actions (story_id, actor_id, action_type, reason, note)
  values (p_story_id, p_actor, 'consent_withdrawn', null, null);
end;
$$;

comment on function public._apply_consent_withdrawal(uuid, uuid) is
  'Internal: performs a consent withdrawal with NO authorization check of its own -- callers authorize first. Shared by revoke_publication_consent() (admin) and decide_story_takedown() (moderator approving a contributor request) so the two can never drift. No API grants.';

revoke execute on function public._apply_consent_withdrawal(uuid, uuid)
  from public, anon, authenticated;

-- 4. revoke_publication_consent() narrows to admin-only -------------------

create or replace function public.revoke_publication_consent(
  p_story_id uuid, p_expected_version integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_story public.stories;
begin
  select * into v_story from public.stories where id = p_story_id for update;
  if not found then raise exception 'No such story: %', p_story_id; end if;
  -- ADMIN ONLY as of this migration. The owner branch is deliberately gone:
  -- a contributor now goes through request_story_takedown() and a moderator
  -- decision. Leaving the owner able to call this directly would make that
  -- approval step bypassable over PostgREST.
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Only an admin can revoke publication consent directly; a contributor requests takedown via request_story_takedown()';
  end if;
  if v_story.version <> p_expected_version then
    raise exception 'Stale version for story % (expected %, got %)', p_story_id, v_story.version, p_expected_version;
  end if;

  perform public._apply_consent_withdrawal(p_story_id, auth.uid());
end;
$$;

comment on function public.revoke_publication_consent(uuid, integer) is
  'ADMIN ONLY as of 20260903100000 (previously owner-or-admin). Reason-free by design. A contributor now asks via request_story_takedown() and a moderator decides -- the owner branch was removed rather than merely hidden in the UI, since this RPC is reachable over PostgREST.';

revoke execute on function public.revoke_publication_consent(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.revoke_publication_consent(uuid, integer) to authenticated;

-- 5. The contributor asks --------------------------------------------------

create or replace function public.request_story_takedown(
  p_story_id uuid,
  p_expected_version integer,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_story public.stories;
  v_request_id uuid;
begin
  select * into v_story from public.stories where id = p_story_id for update;
  if not found then raise exception 'No such story: %', p_story_id; end if;
  if not public._is_story_owner(p_story_id) then
    raise exception 'Only the story owner can request a takedown';
  end if;
  if v_story.version <> p_expected_version then
    raise exception 'Stale version for story % (expected %, got %)', p_story_id, v_story.version, p_expected_version;
  end if;
  if v_story.lifecycle_status <> 'published' then
    raise exception 'Only a published story can be taken down (story %)', p_story_id;
  end if;
  if v_story.consent_revoked_at is not null then
    raise exception 'Consent for story % has already been revoked', p_story_id;
  end if;
  if exists (
    select 1 from public.story_takedown_requests
    where story_id = p_story_id and status = 'pending'
  ) then
    raise exception 'A takedown request for story % is already awaiting review', p_story_id;
  end if;

  insert into public.story_takedown_requests (story_id, requested_by, contributor_note)
  values (p_story_id, auth.uid(), nullif(trim(coalesce(p_note, '')), ''))
  returning id into v_request_id;

  -- The story itself does not change state here -- it stays published until
  -- a moderator decides. Only the version moves, so a stale client cannot
  -- act on pre-request state.
  update public.stories set version = version + 1 where id = p_story_id;

  insert into public.story_publication_state_actions (story_id, actor_id, action_type, reason, note)
  values (p_story_id, auth.uid(), 'takedown_requested', null,
          nullif(trim(coalesce(p_note, '')), ''));

  return v_request_id;
end;
$$;

comment on function public.request_story_takedown(uuid, integer, text) is
  'Owner only. Records a pending takedown request; the story STAYS PUBLISHED until a moderator decides. Note is optional -- a contributor is not required to justify withdrawing their own story. At most one pending request per story.';

revoke execute on function public.request_story_takedown(uuid, integer, text)
  from public, anon, authenticated;
grant execute on function public.request_story_takedown(uuid, integer, text) to authenticated;

-- 6. The contributor changes their mind -----------------------------------

create or replace function public.cancel_story_takedown_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.story_takedown_requests;
begin
  select * into v_request from public.story_takedown_requests
    where id = p_request_id for update;
  if not found then raise exception 'No such takedown request: %', p_request_id; end if;
  if not public._is_story_owner(v_request.story_id) then
    raise exception 'Only the story owner can cancel their takedown request';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'Takedown request % has already been decided', p_request_id;
  end if;

  update public.story_takedown_requests
    set status = 'cancelled', decided_at = now(), decided_by = auth.uid()
    where id = p_request_id;

  update public.stories set version = version + 1 where id = v_request.story_id;

  insert into public.story_publication_state_actions (story_id, actor_id, action_type, reason, note)
  values (v_request.story_id, auth.uid(), 'takedown_cancelled', null, null);
end;
$$;

comment on function public.cancel_story_takedown_request(uuid) is
  'Owner only, pending requests only. Withdrawing the request is not a decision, so the row records who cancelled in decided_by for the audit trail while the status makes clear it was never reviewed.';

revoke execute on function public.cancel_story_takedown_request(uuid)
  from public, anon, authenticated;
grant execute on function public.cancel_story_takedown_request(uuid) to authenticated;

-- 7. The moderator decides -------------------------------------------------

create or replace function public.decide_story_takedown(
  p_request_id uuid,
  p_approve boolean,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.story_takedown_requests;
begin
  if not (public.has_role(auth.uid(), 'moderator') or public.has_role(auth.uid(), 'admin')) then
    raise exception 'Only a moderator or admin can decide a takedown request';
  end if;

  select * into v_request from public.story_takedown_requests
    where id = p_request_id for update;
  if not found then raise exception 'No such takedown request: %', p_request_id; end if;
  if v_request.status <> 'pending' then
    raise exception 'Takedown request % has already been decided', p_request_id;
  end if;

  -- Declining is a decision a contributor will read, so it carries a note.
  -- Approving does not: the contributor already said what they wanted, and
  -- making a moderator write prose to agree with them adds friction to the
  -- outcome that honours consent.
  if not p_approve and (p_note is null or char_length(trim(p_note)) = 0) then
    raise exception 'A note is required when declining a takedown request';
  end if;

  update public.story_takedown_requests
    set status = case when p_approve then 'approved' else 'declined' end,
        decided_by = auth.uid(),
        decided_at = now(),
        decision_note = nullif(trim(coalesce(p_note, '')), '')
    where id = p_request_id;

  if p_approve then
    -- Shared with revoke_publication_consent() so an approved request and an
    -- admin acting directly leave identical state.
    perform public._apply_consent_withdrawal(v_request.story_id, auth.uid());
  else
    update public.stories set version = version + 1 where id = v_request.story_id;
    insert into public.story_publication_state_actions (story_id, actor_id, action_type, reason, note)
    values (v_request.story_id, auth.uid(), 'takedown_declined', null,
            nullif(trim(coalesce(p_note, '')), ''));
  end if;
end;
$$;

comment on function public.decide_story_takedown(uuid, boolean, text) is
  'Moderator/admin only. Approving withdraws consent through the shared _apply_consent_withdrawal(), so it is byte-identical to an admin acting directly. Declining requires a note, since the contributor reads it; approving does not.';

revoke execute on function public.decide_story_takedown(uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.decide_story_takedown(uuid, boolean, text) to authenticated;

-- 8. The queue -------------------------------------------------------------

create or replace function public.list_story_takedown_requests(
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  request_id uuid,
  story_id uuid,
  story_slug text,
  story_title text,
  contributor_note text,
  requested_at timestamptz,
  requester_display_name text,
  story_version integer,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_offset integer;
begin
  if not (public.has_role(auth.uid(), 'moderator') or public.has_role(auth.uid(), 'admin')) then
    raise exception 'Only a moderator or admin can list takedown requests';
  end if;

  -- Same clamp convention as every other staff queue here: a client-supplied
  -- limit can never turn this into an unbounded scan.
  v_limit := greatest(1, least(coalesce(p_limit, 25), 50));
  v_offset := greatest(0, coalesce(p_offset, 0));

  return query
    select
      r.id,
      s.id,
      s.slug,
      pub.title,
      r.contributor_note,
      r.requested_at,
      p.display_name,
      s.version,
      count(*) over ()
    from public.story_takedown_requests r
    join public.stories s on s.id = r.story_id
    left join public.story_revisions pub on pub.id = s.published_revision_id
    left join public.profiles p on p.id = r.requested_by
    where r.status = 'pending'
    order by r.requested_at asc, r.id asc
    limit v_limit offset v_offset;
end;
$$;

comment on function public.list_story_takedown_requests(integer, integer) is
  'Moderator/admin only. Pending takedown requests, oldest first -- the story has stayed public since requested_at, so the oldest request is the most urgent.';

revoke execute on function public.list_story_takedown_requests(integer, integer)
  from public, anon, authenticated;
grant execute on function public.list_story_takedown_requests(integer, integer) to authenticated;

-- 9. The contributor's own view of their request ---------------------------

create or replace function public.get_my_takedown_request(p_story_id uuid)
returns table (
  request_id uuid,
  status text,
  requested_at timestamptz,
  decided_at timestamptz,
  decision_note text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public._is_story_owner(p_story_id) then
    raise exception 'Only the story owner can read their takedown request';
  end if;

  return query
    select r.id, r.status, r.requested_at, r.decided_at, r.decision_note
    from public.story_takedown_requests r
    where r.story_id = p_story_id
    order by r.requested_at desc
    limit 1;
end;
$$;

comment on function public.get_my_takedown_request(uuid) is
  'Owner only. The story''s most recent takedown request, so My Stories can show "awaiting review" and surface a decline note back to the contributor who asked.';

revoke execute on function public.get_my_takedown_request(uuid)
  from public, anon, authenticated;
grant execute on function public.get_my_takedown_request(uuid) to authenticated;
