-- Curates `tags` into the single taxonomy the product now offers, and
-- retires `work_types` from authoring by deactivating its rows.
--
-- Nothing is deleted. story_revision_tags / story_revision_work_types rows
-- on already-published revisions still reference these lookup rows, and
-- get_published_story()/list_published_stories() resolve a work type's name
-- by id without checking `active` -- so an existing published story's
-- recorded work type is preserved in the data even though it is no longer
-- offered to, or shown to, anyone. `active = false` is exactly the retire-
-- without-breaking mechanism these lookup tables were given in
-- 20260803090000_lookup_tables.sql.
--
-- The curated tag set folds in the genuinely useful work-type concepts
-- (horticulture, viticulture, construction, tourism, retail, farm work, ...)
-- alongside the trip-shape and practical-WHV topics a Working Holiday reader
-- actually filters on. Every existing non-fixture tag is kept -- all eleven
-- were already WHV-relevant -- so this migration is purely additive for tags.
--
-- The "RLS Test ..." fixture rows (slug prefix 'rls-test-') are left
-- untouched in both tables: npm run test:rls creates and asserts on them.

insert into public.tags (slug, name) values
  -- Work
  ('fruit-picking',        'Fruit picking'),
  ('horticulture',         'Horticulture'),
  ('viticulture',          'Viticulture'),
  ('farm-work',            'Farm work'),
  ('dairy-farming',        'Dairy farming'),
  ('packhouse-work',       'Packhouse work'),
  ('hospitality',          'Hospitality'),
  ('tourism',              'Tourism'),
  ('construction',         'Construction'),
  ('retail',               'Retail'),
  ('office-work',          'Office work'),
  ('ski-season',           'Ski season'),
  ('au-pair',              'Au pair'),
  ('seasonal-work',        'Seasonal work'),
  ('finding-work',         'Finding work'),
  ('pay-and-conditions',   'Pay & conditions'),
  ('cost-of-living',       'Cost of living'),
  -- Trip shape
  ('van-life',             'Van life'),
  ('road-trip',            'Road trip'),
  ('backpacker-hostels',   'Backpacker hostels'),
  ('budget-travel',        'Budget travel'),
  ('solo-travel',          'Solo travel'),
  ('couple-travel',        'Couple travel'),
  ('first-time-traveller', 'First-time traveller'),
  ('hiking-and-tramping',  'Hiking & tramping'),
  ('buying-a-car',         'Buying a car'),
  -- Place
  ('north-island',         'North Island'),
  ('south-island',         'South Island'),
  -- Practicalities
  ('visa-and-paperwork',   'Visa & paperwork'),
  ('tax-and-ird',          'Tax & IRD'),
  ('second-visa',          'Second visa'),
  ('culture-shock',        'Culture shock')
on conflict (slug) do update
  set name = excluded.name,
      active = true,
      updated_at = now();

-- Retire any tag that is neither in the curated set above nor an RLS
-- fixture. (No row matches today -- every pre-existing tag was kept -- but
-- stating it is what makes the curated list the definition of the taxonomy
-- rather than a one-off insert.)
update public.tags
set active = false, updated_at = now()
where active
  and slug not like 'rls-test-%'
  and slug not in (
    'fruit-picking','horticulture','viticulture','farm-work','dairy-farming',
    'packhouse-work','hospitality','tourism','construction','retail',
    'office-work','ski-season','au-pair','seasonal-work','finding-work',
    'pay-and-conditions','cost-of-living','van-life','road-trip',
    'backpacker-hostels','budget-travel','solo-travel','couple-travel',
    'first-time-traveller','hiking-and-tramping','buying-a-car',
    'north-island','south-island','visa-and-paperwork','tax-and-ird',
    'second-visa','culture-shock'
  );

-- Work types are no longer offered anywhere. Deactivate the real rows; the
-- table, its columns, the join table, and set_revision_work_types() all stay
-- exactly as they are.
update public.work_types
set active = false, updated_at = now()
where active and slug not like 'rls-test-%';

comment on table public.work_types is
  'Retired lookup table (2026-08-16). Tags are the platform''s only taxonomy; every non-fixture row here is active = false and no UI reads this table. Kept, along with story_revision_work_types and set_revision_work_types(), because published revisions still reference these rows.';
