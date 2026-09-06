-- A contributor can name a place that is not in the destinations list.
--
-- WHY THE DESTINATION AND NOT THE REGION. `regions` holds all 16 New Zealand
-- regions -- a genuinely closed set, and the thing every public filter, the
-- story browse page and /costs' by-region cut all key off. `destinations`
-- holds 34 rows, which is a sample of the country's towns, not a list of
-- them. The evidence is already in the data: 10 of the 13 location rows
-- recorded so far have no destination at all, because the place people
-- actually worked was not on offer.
--
-- So region stays a lookup and only the destination becomes typeable. That
-- keeps every regional aggregate mergeable while letting someone say
-- "Kaikohe" or the name of a farm road that will never be a seeded row.
--
-- SHAPE COPIED FROM 20260812110000 and 20260903110000. One difference worth
-- stating: this is NOT a strict "exactly one of" check, because
-- destination_id has always been nullable and a region-only location is
-- valid and common. The rule here is only that a row cannot carry BOTH a
-- looked-up destination and a typed one.
--
-- The existing story_revision_locations_validate_destination trigger already
-- guards "the destination must belong to the region" only when
-- destination_id is not null, so a typed label bypasses nothing -- there is
-- no region/destination relationship left to verify for free text.

alter table public.story_revision_locations
  add column custom_destination_label text;

alter table public.story_revision_locations
  add constraint story_revision_locations_destination_one_of check (
    destination_id is null or custom_destination_label is null
  );

alter table public.story_revision_locations
  add constraint story_revision_locations_custom_label_length check (
    custom_destination_label is null
    or (
      char_length(trim(custom_destination_label)) > 0
      and char_length(custom_destination_label) <= 120
    )
  );

comment on column public.story_revision_locations.custom_destination_label is
  'A contributor-typed place name, for somewhere not in `destinations`. Mutually exclusive with destination_id; a row with neither is a region-only location, which has always been valid.';

-- The writer ---------------------------------------------------------------

create or replace function public.set_revision_locations(
  p_revision_id uuid, p_expected_version integer, p_locations jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_story_id uuid;
  v_version integer;
begin
  select public._authorize_revision_edit(p_revision_id) into v_story_id;
  select version into v_version from public.stories where id = v_story_id;
  if v_version <> p_expected_version then
    raise exception 'Stale version for story % (expected %, got %)', v_story_id, v_version, p_expected_version;
  end if;

  delete from public.story_revision_locations where revision_id = p_revision_id;

  insert into public.story_revision_locations
    (revision_id, region_id, destination_id, custom_destination_label, sort_order)
  select
    p_revision_id,
    (rec ->> 'region_id')::uuid,
    nullif(rec ->> 'destination_id', '')::uuid,
    -- A looked-up destination wins, so a client sending both cannot trip
    -- the CHECK -- the same precedence set_revision_expenses() applies
    -- between category_id and custom_label.
    case
      when nullif(rec ->> 'destination_id', '') is not null then null
      else left(nullif(trim(rec ->> 'custom_destination_label'), ''), 120)
    end,
    coalesce((rec ->> 'sort_order')::int, 0)
  from jsonb_array_elements(coalesce(p_locations, '[]'::jsonb)) as rec;

  update public.stories set version = version + 1 where id = v_story_id;
end;
$$;

comment on function public.set_revision_locations(uuid, integer, jsonb) is
  'Replaces a revision''s locations. Region is always a lookup reference; the destination is either a `destinations` reference, a contributor-typed label, or absent (region-only). An id wins if a client sends both. The enforcing boundary, not the client.';

revoke execute on function public.set_revision_locations(uuid, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.set_revision_locations(uuid, integer, jsonb) to authenticated;
