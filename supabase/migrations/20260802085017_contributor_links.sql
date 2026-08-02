-- contributor_links: append-only audit trail of the trusted process that
-- links an authenticated account to an (editor-created, previously
-- unlinked) contributor record. The authoritative "current link" is always
-- contributors.linked_user_id; this table only records who linked it and
-- when, per the Prompt 2 brief.

create table public.contributor_links (
  id uuid primary key default gen_random_uuid(),
  contributor_id uuid not null references public.contributors (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  linked_by uuid not null references auth.users (id),
  linked_at timestamptz not null default now(),
  note text,
  constraint contributor_links_note_length check (note is null or char_length(note) <= 2000)
);

comment on table public.contributor_links is
  'Append-only audit of trusted contributor<->account linking events. Not publicly readable (Engineering Rule: never publicly expose link history).';

create index contributor_links_contributor_id_idx on public.contributor_links (contributor_id);
create index contributor_links_user_id_idx on public.contributor_links (user_id);

alter table public.contributor_links enable row level security;

create policy "contributor_links: user reads own link history"
  on public.contributor_links
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "contributor_links: staff read all link history"
  on public.contributor_links
  for select
  to authenticated
  using (public.has_role(auth.uid(), 'editor') or public.has_role(auth.uid(), 'admin'));

-- No INSERT/UPDATE/DELETE policy at all: the only writer is
-- link_contributor_to_user() below (SECURITY DEFINER), which re-checks the
-- caller is editor/admin server-side before writing anything. This is what
-- makes contributor-identity hijacking structurally impossible, not just an
-- application-level check.

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

  update public.contributors
  set linked_user_id = p_user_id
  where id = p_contributor_id;

  insert into public.contributor_links (contributor_id, user_id, linked_by, note)
  values (p_contributor_id, p_user_id, auth.uid(), p_note);
end;
$$;

comment on function public.link_contributor_to_user(uuid, uuid, text) is
  'The only sanctioned way to set contributors.linked_user_id after creation. Editor/admin only; rejects contributors already linked to someone else.';

revoke all on function public.link_contributor_to_user(uuid, uuid, text) from public;
grant execute on function public.link_contributor_to_user(uuid, uuid, text) to authenticated;
