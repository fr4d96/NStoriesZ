-- Bug found during Prompt 2 live verification: contributors_protect_privileged_fields()
-- (see 20260802085016_contributors.sql) blocked ANY change to linked_user_id
-- by a non-staff caller — including the FK's own `ON DELETE SET NULL`
-- action when the linked auth.users row is deleted. That cascade runs with
-- no user session (auth.uid() is null), which the trigger's "not staff"
-- branch treated the same as a hijack attempt, raising an exception and
-- causing the user deletion itself to fail.
--
-- Fix: only block a non-staff caller from *assigning/reassigning* a real
-- account (new.linked_user_id is not null and differs from old). Clearing
-- the link (new.linked_user_id is null) is always safe — it can never be
-- used to claim someone else's identity — so it's allowed regardless of
-- caller, which is what lets the ON DELETE SET NULL cascade succeed.

create or replace function public.contributors_protect_privileged_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.has_role(auth.uid(), 'editor') or public.has_role(auth.uid(), 'admin') then
    return new;
  end if;

  if new.linked_user_id is not null
     and new.linked_user_id is distinct from old.linked_user_id then
    raise exception 'Only an editor or admin can change a contributor''s linked account';
  end if;

  if new.created_by is distinct from old.created_by then
    raise exception 'created_by cannot be changed';
  end if;

  if new.public_status = 'archived' and old.public_status <> 'archived' then
    raise exception 'Only an editor or admin can archive a contributor record';
  end if;

  return new;
end;
$$;
