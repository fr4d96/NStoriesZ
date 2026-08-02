-- contributors: the identity a story is attributed to. Distinct from
-- profiles/auth.users because a contributor record can exist before any
-- account does (founding-catalogue editor import — see docs/product-spec.md
-- "Curated founding catalogue" journey).

create type public.attribution_type as enum ('real_name', 'display_name', 'pseudonym', 'anonymous');
create type public.contributor_status as enum ('private', 'public', 'archived');

create table public.contributors (
  id uuid primary key default gen_random_uuid(),
  linked_user_id uuid unique references auth.users (id) on delete set null,
  display_name text not null,
  public_slug text,
  bio text,
  avatar_path text,
  attribution_type public.attribution_type not null default 'display_name',
  public_status public.contributor_status not null default 'private',
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contributors_display_name_length check (char_length(display_name) between 1 and 120),
  constraint contributors_bio_length check (bio is null or char_length(bio) <= 2000),
  constraint contributors_public_slug_format check (
    public_slug is null or public_slug ~ '^[a-z0-9][a-z0-9-]{2,59}$'
  )
);

comment on table public.contributors is
  'The identity a story is attributed to. May exist before any linked account (editor-assisted founding-catalogue import) or be created by a self-service user for themselves.';
comment on column public.contributors.linked_user_id is
  'Set only via a trusted process: direct self-insert with linked_user_id = auth.uid(), or public.link_contributor_to_user() (editor/admin only). Never client-settable to an arbitrary user.';

-- A slug can only be unique while actually public (a private/archived draft
-- shouldn't block a slug someone else wants to publish under).
create unique index contributors_public_slug_unique_idx
  on public.contributors (lower(public_slug))
  where public_status = 'public';

create trigger contributors_set_updated_at
  before update on public.contributors
  for each row
  execute function public.set_updated_at();

-- Structural protection against contributor-identity hijacking: once set,
-- linked_user_id can only be changed by an editor/admin, and public_status
-- can only be escalated to 'archived' by staff. RLS's WITH CHECK cannot see
-- the OLD row on UPDATE, so this has to be a trigger rather than a pure RLS
-- clause.
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

  if new.linked_user_id is distinct from old.linked_user_id then
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

create trigger contributors_protect_privileged_fields
  before update on public.contributors
  for each row
  execute function public.contributors_protect_privileged_fields();

alter table public.contributors enable row level security;

create policy "contributors: public can read public contributors"
  on public.contributors
  for select
  to anon, authenticated
  using (public_status = 'public');

create policy "contributors: owner reads own contributor record"
  on public.contributors
  for select
  to authenticated
  using (auth.uid() = linked_user_id);

create policy "contributors: staff read all contributor records"
  on public.contributors
  for select
  to authenticated
  using (
    public.has_role(auth.uid(), 'editor')
    or public.has_role(auth.uid(), 'moderator')
    or public.has_role(auth.uid(), 'admin')
  );

-- Self-service: a signed-in user may create exactly one contributor record
-- for themselves (enforced by the unique index on linked_user_id).
create policy "contributors: self-service create own contributor record"
  on public.contributors
  for insert
  to authenticated
  with check (linked_user_id = auth.uid() and created_by = auth.uid());

-- Editor-assisted import: linked_user_id must be NULL at creation time —
-- linking to a real account only ever happens afterward, through
-- link_contributor_to_user() below.
create policy "contributors: staff create unlinked contributor records"
  on public.contributors
  for insert
  to authenticated
  with check (
    linked_user_id is null
    and created_by = auth.uid()
    and (public.has_role(auth.uid(), 'editor') or public.has_role(auth.uid(), 'admin'))
  );

create policy "contributors: owner or staff update contributor record"
  on public.contributors
  for update
  to authenticated
  using (
    auth.uid() = linked_user_id
    or public.has_role(auth.uid(), 'editor')
    or public.has_role(auth.uid(), 'admin')
  )
  with check (
    auth.uid() = linked_user_id
    or public.has_role(auth.uid(), 'editor')
    or public.has_role(auth.uid(), 'admin')
  );

-- Hard delete is an admin-only exception path; normal removal from public
-- view is archiving (public_status = 'archived'), which retains the record
-- per docs/content-governance.md "Corrections, withdrawal, and deletion".
create policy "contributors: admin can delete"
  on public.contributors
  for delete
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));
