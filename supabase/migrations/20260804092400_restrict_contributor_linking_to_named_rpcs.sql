-- Prompt 4 Sub-phase 4: restricted, audited contributor link/unlink RPCs and
-- an append-only, RPC-only contributor_links history.
--
-- Before this migration, contributors.linked_user_id could be changed by a
-- direct UPDATE from anyone the "contributors: owner or staff update
-- contributor record" RLS policy allows to update the row at all (owner or
-- staff) -- contributors_protect_privileged_fields() blocked a NON-staff
-- caller from assigning/reassigning it, but let ANY staff caller change it
-- via a bare UPDATE, bypassing link_contributor_to_user()'s own
-- already-linked/not-linked state checks and leaving no corresponding
-- contributor_links audit row. This migration closes that: linked_user_id
-- can now ONLY be changed via the two named RPCs below, for every
-- transition except the literal ON DELETE SET NULL FK cascade (detected
-- narrowly: both new.linked_user_id is null AND auth.uid() is null -- the
-- only trigger-firing context in this schema with no active session at
-- all).

-- contributor_links gains event_type -- additive, existing rows default to
-- 'linked' (every row created before this migration genuinely was a link
-- event; there was no unlink RPC yet for one to be an unlink).
alter table public.contributor_links
  add column event_type text not null default 'linked'
    check (event_type in ('linked', 'unlinked'));

comment on column public.contributor_links.event_type is
  'Which operation this audit row records. Always set explicitly by link_contributor_to_user() (''linked'') or unlink_contributor_from_user() (''unlinked'') -- the column default only backfills pre-Sub-phase-4 rows, which were all link events.';

-- Internal, ungranted helper: the ONLY place that ever calls set_config for
-- this purpose (verified by grepping the full supabase/migrations/ tree --
-- no other function anywhere touches this GUC), and the only place that
-- ever writes contributors.linked_user_id. Both named RPCs below go through
-- this rather than each independently managing the GUC and the UPDATE, so
-- there is exactly one place this pairing can ever drift.
--
-- The GUC is an internal signal only, never the authorization boundary --
-- the actual authorization (editor/admin role, already-linked/not-linked
-- state checks) lives entirely inside link_contributor_to_user()/
-- unlink_contributor_from_user(), unchanged from before. This helper and
-- the trigger it feeds only confirm that some already-authorized RPC call
-- is in progress, and which direction it is performing.
create or replace function public._set_contributor_linked_user(
  p_contributor_id uuid,
  p_new_linked_user_id uuid,
  p_operation text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_operation not in ('link', 'unlink') then
    raise exception 'Invalid contributor-link operation: %', p_operation;
  end if;

  -- is_local = true scopes this to the current transaction only -- for a
  -- PostgREST-invoked RPC call, that is exactly the lifetime of this single
  -- statement's caller (link_contributor_to_user()/
  -- unlink_contributor_from_user()), auto-reset at the end of it. No
  -- manual reset is needed or attempted.
  perform set_config('app.contributor_link_operation', p_operation, true);
  update public.contributors set linked_user_id = p_new_linked_user_id where id = p_contributor_id;
end;
$$;

comment on function public._set_contributor_linked_user(uuid, uuid, text) is
  'Internal: the only function that ever writes contributors.linked_user_id. Sets a transaction-local operation signal (app.contributor_link_operation) that contributors_protect_privileged_fields() checks, then performs the update. No API grants -- callable only from other SECURITY DEFINER functions, same convention as _is_story_owner()/_authorize_revision_edit()/etc.';

revoke execute on function public._set_contributor_linked_user(uuid, uuid, text)
  from public, anon, authenticated;
-- No grant statement, on purpose.

-- Trigger rewrite: every transition of linked_user_id, including
-- non-null-to-null, now requires the GUC set by _set_contributor_linked_user()
-- to match the transition direction -- with the single narrow exemption for
-- the ON DELETE SET NULL cascade. The previous "staff bypass everything"
-- shortcut is removed specifically for linked_user_id (an editor/admin must
-- now also go through the RPCs for that column) but is kept, restated
-- explicitly, for the public_status = 'archived' escalation -- there is no
-- dedicated archive RPC, and this migration does not add one.
create or replace function public.contributors_protect_privileged_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.linked_user_id is distinct from old.linked_user_id then
    if new.linked_user_id is null and auth.uid() is null then
      -- ON DELETE SET NULL cascade only -- narrow, not "any unlink". A null
      -- auth.uid() does not, on its own, prove every possible trigger
      -- invocation is this cascade in general; it is safe here specifically
      -- because it is combined with new.linked_user_id being cleared to
      -- null, which is the one direction a hijack attempt could never
      -- benefit from anyway, and because this is the only trigger-firing
      -- context in this schema that runs with no session at all.
      return new;
    end if;

    declare
      v_op text := coalesce(current_setting('app.contributor_link_operation', true), '');
    begin
      if new.linked_user_id is not null and v_op <> 'link' then
        raise exception 'linked_user_id may only be assigned via link_contributor_to_user()';
      end if;
      if new.linked_user_id is null and v_op <> 'unlink' then
        raise exception 'linked_user_id may only be cleared via unlink_contributor_from_user()';
      end if;
    end;
  end if;

  if new.created_by is distinct from old.created_by then
    raise exception 'created_by cannot be changed';
  end if;

  if new.public_status = 'archived' and old.public_status <> 'archived' then
    if not (public.has_role(auth.uid(), 'editor') or public.has_role(auth.uid(), 'admin')) then
      raise exception 'Only an editor or admin can archive a contributor record';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.contributors_protect_privileged_fields() is
  'Prompt 4 Sub-phase 4: linked_user_id can now only be changed via link_contributor_to_user()/unlink_contributor_from_user() (through the app.contributor_link_operation GUC), for every transition except the literal ON DELETE SET NULL cascade -- including by an editor/admin, who no longer bypass this column via a bare UPDATE. created_by remains always-immutable; archiving remains editor/admin-only, unchanged.';

-- link_contributor_to_user(): authorization/state-check logic unchanged;
-- the UPDATE now goes through the shared helper, and the audit insert
-- states event_type explicitly.
create or replace function public.link_contributor_to_user(
  p_contributor_id uuid,
  p_user_id uuid,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_linked_user_id uuid;
begin
  if not (public.has_role(auth.uid(), 'editor') or public.has_role(auth.uid(), 'admin')) then
    raise exception 'Only an editor or admin can link a contributor record to an account';
  end if;

  select linked_user_id into v_current_linked_user_id
  from public.contributors
  where id = p_contributor_id
  for update;

  if not found then
    raise exception 'No such contributor record: %', p_contributor_id;
  end if;

  if v_current_linked_user_id is not null then
    raise exception 'Contributor % is already linked to an account', p_contributor_id;
  end if;

  perform public._set_contributor_linked_user(p_contributor_id, p_user_id, 'link');

  insert into public.contributor_links (contributor_id, user_id, linked_by, note, event_type)
  values (p_contributor_id, p_user_id, auth.uid(), p_note, 'linked');
end;
$$;

comment on function public.link_contributor_to_user(uuid, uuid, text) is
  'The only sanctioned way to set contributors.linked_user_id after creation. Editor/admin only; rejects contributors already linked to someone else. Prompt 4 Sub-phase 4: routes the write through _set_contributor_linked_user() and records event_type = ''linked'' explicitly.';

revoke all on function public.link_contributor_to_user(uuid, uuid, text) from public;
grant execute on function public.link_contributor_to_user(uuid, uuid, text) to authenticated;

-- New: unlink_contributor_from_user(). Editor/admin only. Unlinking is
-- about the CONTRIBUTOR IDENTITY, not any specific story -- the
-- source-kind-partitioned fix in migration 20260804092200 (plus its own
-- companion fix inside submit_revision_with_consent(), migration
-- 20260804092100) already guarantees a self-service story's access can
-- never be affected by unlinking/relinking the contributor record it
-- happens to reference, so this RPC adds no extra blocking logic of its
-- own for that case -- it succeeds regardless of what stories the
-- contributor is attached to, exactly as the round-6 plan specifies.
create or replace function public.unlink_contributor_from_user(
  p_contributor_id uuid,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous_linked_user_id uuid;
begin
  if not (public.has_role(auth.uid(), 'editor') or public.has_role(auth.uid(), 'admin')) then
    raise exception 'Only an editor or admin can unlink a contributor record from an account';
  end if;

  select linked_user_id into v_previous_linked_user_id
  from public.contributors
  where id = p_contributor_id
  for update;

  if not found then
    raise exception 'No such contributor record: %', p_contributor_id;
  end if;

  if v_previous_linked_user_id is null then
    raise exception 'Contributor % is not currently linked', p_contributor_id;
  end if;

  -- Captured above, before clearing -- the audit row must record who was
  -- removed, and the column will already be null by the time any read
  -- after the update could otherwise observe it.
  perform public._set_contributor_linked_user(p_contributor_id, null, 'unlink');

  insert into public.contributor_links (contributor_id, user_id, linked_by, note, event_type)
  values (p_contributor_id, v_previous_linked_user_id, auth.uid(), p_note, 'unlinked');
end;
$$;

comment on function public.unlink_contributor_from_user(uuid, text) is
  'Editor/admin only. Clears contributors.linked_user_id via _set_contributor_linked_user() and records an ''unlinked'' audit row against the account that was removed. Unlinking concerns the contributor identity only -- it never touches any story, and the source-kind-partitioned authorization fix (migration 20260804092200) guarantees a self-service story''s access is unaffected by this regardless of which contributor record it references.';

revoke all on function public.unlink_contributor_from_user(uuid, text) from public;
grant execute on function public.unlink_contributor_from_user(uuid, text) to authenticated;
