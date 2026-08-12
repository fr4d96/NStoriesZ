-- Real reference data (not fictional/test), unlike supabase/seed.sql:
-- regions/destinations are the location lookup tables that public browsing,
-- filtering, and the Locations search bar (components/story/location-search.tsx)
-- all depend on. They were never actually seeded on the hosted project --
-- only leftover story-rls.integration.test.ts fixture rows ("RLS Test
-- Region A/B") existed until this migration, which meant every real place
-- search had nothing to match against. Idempotent via `on conflict do
-- nothing` on each table's unique slug, so re-running this migration (or
-- applying it after a future manual edit) never duplicates rows.
--
-- Covers the 16 official NZ regional council regions, plus common
-- Working Holiday Visa destination towns/cities per region.

insert into public.regions (slug, name, island_or_grouping) values
  ('northland', 'Northland', 'North Island'),
  ('auckland', 'Auckland', 'North Island'),
  ('waikato', 'Waikato', 'North Island'),
  ('bay-of-plenty', 'Bay of Plenty', 'North Island'),
  ('gisborne', 'Gisborne', 'North Island'),
  ('hawkes-bay', 'Hawke''s Bay', 'North Island'),
  ('taranaki', 'Taranaki', 'North Island'),
  ('manawatu-whanganui', 'Manawatū-Whanganui', 'North Island'),
  ('wellington', 'Wellington', 'North Island'),
  ('tasman', 'Tasman', 'South Island'),
  ('nelson', 'Nelson', 'South Island'),
  ('marlborough', 'Marlborough', 'South Island'),
  ('west-coast', 'West Coast', 'South Island'),
  ('canterbury', 'Canterbury', 'South Island'),
  ('otago', 'Otago', 'South Island'),
  ('southland', 'Southland', 'South Island')
on conflict (slug) do nothing;

with r as (select id, slug from public.regions)
insert into public.destinations (region_id, slug, name)
select r.id, d.slug, d.name
from (values
  ('northland', 'whangarei', 'Whangārei'),
  ('northland', 'bay-of-islands', 'Bay of Islands'),
  ('northland', 'kerikeri', 'Kerikeri'),
  ('auckland', 'auckland-city', 'Auckland City'),
  ('auckland', 'waiheke-island', 'Waiheke Island'),
  ('waikato', 'hamilton', 'Hamilton'),
  ('waikato', 'raglan', 'Raglan'),
  ('waikato', 'cambridge', 'Cambridge'),
  ('bay-of-plenty', 'tauranga', 'Tauranga'),
  ('bay-of-plenty', 'rotorua', 'Rotorua'),
  ('bay-of-plenty', 'whakatane', 'Whakatāne'),
  ('gisborne', 'gisborne-city', 'Gisborne'),
  ('hawkes-bay', 'napier', 'Napier'),
  ('hawkes-bay', 'hastings', 'Hastings'),
  ('taranaki', 'new-plymouth', 'New Plymouth'),
  ('manawatu-whanganui', 'palmerston-north', 'Palmerston North'),
  ('manawatu-whanganui', 'whanganui', 'Whanganui'),
  ('wellington', 'wellington-city', 'Wellington City'),
  ('wellington', 'lower-hutt', 'Lower Hutt'),
  ('tasman', 'motueka', 'Motueka'),
  ('tasman', 'golden-bay', 'Golden Bay'),
  ('nelson', 'nelson-city', 'Nelson'),
  ('marlborough', 'blenheim', 'Blenheim'),
  ('marlborough', 'picton', 'Picton'),
  ('west-coast', 'greymouth', 'Greymouth'),
  ('west-coast', 'franz-josef', 'Franz Josef'),
  ('west-coast', 'hokitika', 'Hokitika'),
  ('canterbury', 'christchurch', 'Christchurch'),
  ('canterbury', 'methven', 'Methven'),
  ('otago', 'dunedin', 'Dunedin'),
  ('otago', 'queenstown', 'Queenstown'),
  ('otago', 'wanaka', 'Wanaka'),
  ('southland', 'invercargill', 'Invercargill'),
  ('southland', 'te-anau', 'Te Anau')
) as d(region_slug, slug, name)
join r on r.slug = d.region_slug
on conflict (region_id, slug) do nothing;
