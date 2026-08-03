-- Prompt 4: narrow, service_role-only reconciliation functions for the
-- maintenance script (scripts/cleanup-abandoned-media-uploads.mjs). The
-- script's SQL only ever SELECTs candidates and deletes actual Storage
-- objects via the Storage API; every database mutation goes through one of
-- these two functions rather than raw UPDATE/DELETE, so maintenance
-- mutations respect the exact same DB-level invariants (transition
-- trigger, state-dependent constraints, immutable-resolution trigger) as
-- every other path in the system.

create or replace function public.maintenance_cancel_abandoned_reservation(p_media_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_media public.story_media;
begin
  select * into v_media from public.story_media where id = p_media_id for update;
  if not found then
    raise exception 'No such media: %', p_media_id;
  end if;
  if v_media.processing_state <> 'pending_upload' then
    raise exception 'Media % is not an abandoned pending upload (state %)', p_media_id, v_media.processing_state;
  end if;

  delete from public.story_media where id = p_media_id;
end;
$$;

comment on function public.maintenance_cancel_abandoned_reservation(uuid) is
  'Deletes a still-pending_upload story_media row after its storage object (if any) has already been deleted by the maintenance script via the Storage API. service_role only.';

revoke execute on function public.maintenance_cancel_abandoned_reservation(uuid) from public, anon, authenticated;
grant execute on function public.maintenance_cancel_abandoned_reservation(uuid) to service_role;

create or replace function public.maintenance_resolve_orphaned_copy_attempt(p_copy_attempt_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_copy public.story_media_public_copy_attempts;
begin
  select * into v_copy from public.story_media_public_copy_attempts
    where id = p_copy_attempt_id for update;
  if not found then
    raise exception 'No such copy attempt: %', p_copy_attempt_id;
  end if;
  if v_copy.resolved_at is not null then
    return; -- already resolved (idempotent no-op)
  end if;

  update public.story_media_public_copy_attempts
    set resolved_at = now(), resolution = 'abandoned', updated_at = now()
    where id = p_copy_attempt_id;

  update public.story_media
    set processing_state = 'processed'
    where id = v_copy.media_id and processing_state = 'promotion_pending';
end;
$$;

comment on function public.maintenance_resolve_orphaned_copy_attempt(uuid) is
  'Marks an orphaned copy-attempt row resolved (retained, never deleted, per the audit-trail design) and reverts its media out of promotion_pending if still stuck there, after the maintenance script has already deleted the orphaned public object via the Storage API. service_role only.';

revoke execute on function public.maintenance_resolve_orphaned_copy_attempt(uuid) from public, anon, authenticated;
grant execute on function public.maintenance_resolve_orphaned_copy_attempt(uuid) to service_role;
