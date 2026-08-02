-- Reference/lookup data for stories: regions, destinations, work types, and
-- tags. Nationality/destination/work classification are data, not hard-coded
-- UI strings (docs/product-spec.md). No ownership, no lifecycle, no
-- sensitive columns — the only story-domain tables that keep plain RLS with
-- real grants instead of going through SECURITY DEFINER functions.

create table public.regions (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  island_or_grouping text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint regions_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{1,59}$'),
  constraint regions_name_length check (char_length(name) between 1 and 120)
);

create table public.destinations (
  id uuid primary key default gen_random_uuid(),
  region_id uuid not null references public.regions (id) on delete restrict,
  slug text not null,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint destinations_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{1,59}$'),
  constraint destinations_name_length check (char_length(name) between 1 and 120),
  constraint destinations_region_slug_unique unique (region_id, slug)
);

create index destinations_region_id_idx on public.destinations (region_id);

create table public.work_types (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_types_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{1,59}$'),
  constraint work_types_name_length check (char_length(name) between 1 and 120)
);

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tags_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{1,59}$'),
  constraint tags_name_length check (char_length(name) between 1 and 120)
);

create trigger regions_set_updated_at before update on public.regions
  for each row execute function public.set_updated_at();
create trigger destinations_set_updated_at before update on public.destinations
  for each row execute function public.set_updated_at();
create trigger work_types_set_updated_at before update on public.work_types
  for each row execute function public.set_updated_at();
create trigger tags_set_updated_at before update on public.tags
  for each row execute function public.set_updated_at();

alter table public.regions enable row level security;
alter table public.destinations enable row level security;
alter table public.work_types enable row level security;
alter table public.tags enable row level security;

create policy "regions: anyone reads active regions"
  on public.regions for select to anon, authenticated using (active = true);
create policy "regions: staff read all regions"
  on public.regions for select to authenticated
  using (public.has_role(auth.uid(), 'editor') or public.has_role(auth.uid(), 'admin'));
create policy "regions: admin writes"
  on public.regions for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

create policy "destinations: anyone reads active destinations"
  on public.destinations for select to anon, authenticated using (active = true);
create policy "destinations: staff read all destinations"
  on public.destinations for select to authenticated
  using (public.has_role(auth.uid(), 'editor') or public.has_role(auth.uid(), 'admin'));
create policy "destinations: admin writes"
  on public.destinations for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

create policy "work_types: anyone reads active work types"
  on public.work_types for select to anon, authenticated using (active = true);
create policy "work_types: staff read all work types"
  on public.work_types for select to authenticated
  using (public.has_role(auth.uid(), 'editor') or public.has_role(auth.uid(), 'admin'));
create policy "work_types: admin writes"
  on public.work_types for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

create policy "tags: anyone reads active tags"
  on public.tags for select to anon, authenticated using (active = true);
create policy "tags: staff read all tags"
  on public.tags for select to authenticated
  using (public.has_role(auth.uid(), 'editor') or public.has_role(auth.uid(), 'admin'));
create policy "tags: admin writes"
  on public.tags for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));
