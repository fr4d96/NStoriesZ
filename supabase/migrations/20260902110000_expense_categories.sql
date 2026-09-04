-- Curated categories for a story's optional expense breakdown.
--
-- A story today carries ONE lump number, story_revisions
-- .total_expense_nzd_cents. That answers "what did the whole thing cost"
-- and nothing else. This table is the vocabulary for the follow-up
-- question -- flights, rent, the car -- recorded per revision in
-- story_revision_expenses (next migration).
--
-- WHY THIS LIVES HERE, with the other lookup tables. It follows the ACCESS
-- MODEL split this schema already uses: reference data with no ownership,
-- no lifecycle and nothing sensitive keeps plain RLS plus real grants
-- (20260803090000_lookup_tables.sql); anything keyed to a revision goes
-- through SECURITY DEFINER functions with zero grants
-- (20260803090300_story_revision_relations.sql). Expense categories are
-- reference data, so everything below mirrors `tags` exactly: same slug
-- format, same name length, same set_updated_at trigger, the same four
-- policies (anon/authenticated read active, staff read all, admin writes).
--
-- CURATED ONLY -- deliberately NOT the story_revision_tags.custom_label
-- model. A contributor can type any tag they like because a tag is a label
-- on one story. An expense exists to be added up ACROSS stories ("what
-- does a first month actually cost"), and free text makes that impossible:
-- "car", "van stuff" and "vehicle" are three unmergeable buckets for one
-- thing. The `other` category plus a short per-row note covers the long
-- tail without poisoning the aggregate.
--
-- TWO ADDITIONS over `tags`:
--   * `description` -- one line of guidance under the category name in the
--     editor ("Flights to and from New Zealand"), so two contributors put
--     the same spend in the same bucket. Nullable; 300 chars is plenty.
--   * `sort_order` -- the editor lists these in trip order (flights, visa,
--     insurance, then on-the-ground costs), which is not alphabetical and
--     is not creation order. Ties break on name, hence the composite index.

create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expense_categories_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{1,59}$'),
  constraint expense_categories_name_length check (char_length(name) between 1 and 120),
  constraint expense_categories_description_length check (
    description is null or char_length(description) between 1 and 300
  )
);

create index expense_categories_sort_order_idx
  on public.expense_categories (sort_order, name);

create trigger expense_categories_set_updated_at before update on public.expense_categories
  for each row execute function public.set_updated_at();

alter table public.expense_categories enable row level security;

create policy "expense_categories: anyone reads active categories"
  on public.expense_categories for select to anon, authenticated using (active = true);
create policy "expense_categories: staff read all categories"
  on public.expense_categories for select to authenticated
  using (public.has_role(auth.uid(), 'editor') or public.has_role(auth.uid(), 'admin'));
create policy "expense_categories: admin writes"
  on public.expense_categories for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- Seeded HERE, in the migration, not in supabase/seed.sql. seed.sql runs
-- only on a local `supabase db reset`, which is blocked in this repo's
-- environment (no container runtime -- see docs/architecture.md), and more
-- importantly this is not fixture data: the expense editor renders nothing
-- at all without these rows, so they are part of the schema the feature
-- needs, not sample content. `on conflict do nothing` keeps the migration
-- re-runnable.
insert into public.expense_categories (slug, name, description, sort_order)
values
  ('flights', 'Flights', 'Flights to and from New Zealand.', 10),
  ('visa-fee', 'Visa fee', 'The working holiday visa application fee itself.', 20),
  ('insurance', 'Insurance', 'Travel and/or medical insurance for the trip.', 30),
  ('first-month-rent', 'First month rent', 'Rent for your first month after arriving.', 40),
  ('bond', 'Bond', 'Rental bond or deposit paid up front.', 50),
  ('vehicle', 'Vehicle', 'Buying, renting or running a car, van or campervan.', 60),
  ('gear', 'Gear', 'Clothing, boots, camping and work gear bought for the trip.', 70),
  ('food', 'Food', 'Groceries and eating out.', 80),
  ('transport', 'Transport', 'Buses, trains, ferries and domestic flights within New Zealand.', 90),
  ('activities', 'Activities', 'Tours, hikes, jumps, dives and other things you paid to do.', 100),
  ('other', 'Other', 'Anything that does not fit the categories above -- add a short note.', 999)
on conflict (slug) do nothing;

comment on table public.expense_categories is
  'Curated vocabulary for a story revision''s optional expense breakdown. Deliberately closed (no contributor-authored labels, unlike story_revision_tags.custom_label) because expenses exist to be aggregated across stories; the `other` row plus story_revision_expenses.note carries the long tail.';
