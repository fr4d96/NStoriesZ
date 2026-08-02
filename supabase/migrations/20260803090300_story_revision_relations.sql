-- Per-revision relational data: locations, work types, tags. Keyed off
-- revision_id (not story_id) so an unapproved revision's associations never
-- leak into a public read of the published one. No direct API grants —
-- written only via set_revision_locations()/set_revision_work_types()/
-- set_revision_tags() in story_lifecycle_functions.sql.

create table public.story_revision_locations (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.story_revisions (id) on delete restrict,
  region_id uuid not null references public.regions (id) on delete restrict,
  destination_id uuid references public.destinations (id) on delete restrict,
  sort_order integer not null default 0
);

create index story_revision_locations_revision_id_idx on public.story_revision_locations (revision_id);
create index story_revision_locations_region_id_idx on public.story_revision_locations (region_id);
create index story_revision_locations_destination_id_idx on public.story_revision_locations (destination_id);

-- Cross-table integrity (a destination must belong to the selected region)
-- can't be a plain CHECK constraint, so it's a trigger.
create or replace function public.story_revision_locations_validate_destination()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.destination_id is not null then
    if not exists (
      select 1 from public.destinations
      where id = new.destination_id and region_id = new.region_id
    ) then
      raise exception 'destination % does not belong to region %', new.destination_id, new.region_id;
    end if;
  end if;
  return new;
end;
$$;

create trigger story_revision_locations_validate_destination
  before insert or update on public.story_revision_locations
  for each row
  execute function public.story_revision_locations_validate_destination();

create table public.story_revision_work_types (
  revision_id uuid not null references public.story_revisions (id) on delete restrict,
  work_type_id uuid not null references public.work_types (id) on delete restrict,
  primary key (revision_id, work_type_id)
);

create table public.story_revision_tags (
  revision_id uuid not null references public.story_revisions (id) on delete restrict,
  tag_id uuid not null references public.tags (id) on delete restrict,
  primary key (revision_id, tag_id)
);

create index story_revision_work_types_work_type_id_idx on public.story_revision_work_types (work_type_id);
create index story_revision_tags_tag_id_idx on public.story_revision_tags (tag_id);

-- Defense-in-depth: even though nothing has a direct write grant on these
-- tables (only the SECURITY DEFINER set_revision_*() functions write them,
-- and those already check _revision_is_editable before writing), this
-- trigger backs up that intent structurally, in case a future function has
-- a bug — mirrors contributors_protect_privileged_fields()'s "trigger, not
-- just caller discipline" pattern. Shared across all four per-revision
-- child tables (locations/work_types/tags/media) since they all key off a
-- revision_id column.
create or replace function public._protect_revision_child_immutability()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_revision_id uuid := coalesce(new.revision_id, old.revision_id);
begin
  if not public._revision_is_editable(v_revision_id) then
    raise exception 'Cannot modify child rows of a revision that is not currently editable (revision %)', v_revision_id;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger story_revision_locations_protect_immutability
  before insert or update or delete on public.story_revision_locations
  for each row
  execute function public._protect_revision_child_immutability();

create trigger story_revision_work_types_protect_immutability
  before insert or update or delete on public.story_revision_work_types
  for each row
  execute function public._protect_revision_child_immutability();

create trigger story_revision_tags_protect_immutability
  before insert or update or delete on public.story_revision_tags
  for each row
  execute function public._protect_revision_child_immutability();

alter table public.story_revision_locations enable row level security;
alter table public.story_revision_work_types enable row level security;
alter table public.story_revision_tags enable row level security;
-- No policies — every access is a SECURITY DEFINER function.
