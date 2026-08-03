-- Prompt 4: begin_story_publication_attempt() is the only way a
-- story_publication_attempts row comes into existence — the id is minted
-- server-side (gen_random_uuid(), via the table's default), never accepted
-- as a client-supplied parameter. Ownership is established here
-- (initiated_by = auth.uid()) and enforced by every later function that
-- acts on the attempt.

create or replace function public.begin_story_publication_attempt(p_revision_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revision public.story_revisions;
  v_attempt_id uuid;
begin
  if not (public.has_role(auth.uid(), 'moderator') or public.has_role(auth.uid(), 'admin')) then
    raise exception 'Only a moderator or admin can begin a publication attempt';
  end if;

  select * into v_revision from public.story_revisions where id = p_revision_id for update;
  if not found then
    raise exception 'No such revision: %', p_revision_id;
  end if;
  if v_revision.revision_status <> 'submitted' then
    raise exception 'Revision % is not currently submitted', p_revision_id;
  end if;

  -- The partial unique index (revision_id) where status = 'active' is the
  -- real, structural guarantee that only one attempt is ever active per
  -- revision — this insert simply surfaces that as a clear application
  -- error rather than a bare constraint-violation message.
  if exists (
    select 1 from public.story_publication_attempts
    where revision_id = p_revision_id and status = 'active'
  ) then
    raise exception 'Revision % already has an active publication attempt', p_revision_id;
  end if;

  insert into public.story_publication_attempts (revision_id, initiated_by, status)
  values (p_revision_id, auth.uid(), 'active')
  returning id into v_attempt_id;

  return v_attempt_id;
end;
$$;

comment on function public.begin_story_publication_attempt(uuid) is
  'Mints a fresh, server-generated publication-attempt id for a submitted revision. Only one attempt may be active per revision at a time (enforced structurally by a partial unique index, not merely this check). The initiating moderator (or an admin) is the only caller who may later act on this attempt.';

revoke execute on function public.begin_story_publication_attempt(uuid) from public, anon, authenticated;
grant execute on function public.begin_story_publication_attempt(uuid) to authenticated;
