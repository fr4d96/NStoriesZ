-- Corrective to 20260910090000: contributor_public_facts() dropped every
-- contributor-typed tag from a byline page.
--
-- THE BUG. `story_revision_tags` rows are EITHER a `tag_id` referencing the
-- curated `public.tags` list OR a free-text `custom_label` the contributor
-- typed (20260812110000_work_type_tag_custom_labels.sql, extended by
-- 20260816100000). 20260910090000 joined `public.tags` with an INNER join,
-- so every custom-label row -- which has `tag_id` NULL -- was silently
-- discarded. Caught live rather than by a test: KakiKu's byline returned
-- `tags: []` while two of their four published revisions carried a tag row
-- each ("Good Vibes" and "Auckland").
--
-- The codebase had already written this rule down, twice. 20260812110000's
-- own section header says public reads use "LEFT JOIN + coalesce to the
-- lookup name", and 20260903120000 spells out the consequence of not doing
-- so: "an inner join would silently drop every typed one". This restores
-- the house pattern rather than inventing a third one.
--
-- WHY IT LOOKED FINE. The regions aggregate beside it uses an inner join
-- and is CORRECT, because `story_revision_locations.region_id` is NOT NULL
-- -- a location row always resolves to a real region (its sibling
-- `custom_destination_label` only ever replaces the optional DESTINATION,
-- which this function does not read). Two structurally identical-looking
-- joins, only one of which was safe.
--
-- No DROP needed: the return type is unchanged, so CREATE OR REPLACE keeps
-- the function's existing grants (it has none -- it is internal, reachable
-- only from the two public RPCs).

create or replace function public.contributor_public_facts(p_contributor_id uuid)
returns table (
  published_story_count bigint,
  regions text[],
  trip_years smallint[],
  tags text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  with published as (
    select s.id as story_id, s.published_revision_id as revision_id, r.trip_year
    from public.stories s
    join public.story_revisions r
      on r.id = s.published_revision_id
     and r.story_id = s.id
     and r.revision_status = 'approved'
    where s.contributor_id = p_contributor_id
      and s.visibility = 'public'
      and s.lifecycle_status = 'published'
      and s.consent_revoked_at is null
      and exists (
        select 1 from public.story_publication_consents con
        where con.story_id = s.id
          and con.revision_id = s.published_revision_id
          and con.consent_status = 'granted'
      )
  )
  select
    (select count(*) from published),
    (
      -- Inner join is correct here and only here: region_id is NOT NULL.
      select coalesce(array_agg(distinct reg.name order by reg.name), '{}'::text[])
      from published pub
      join public.story_revision_locations loc on loc.revision_id = pub.revision_id
      join public.regions reg on reg.id = loc.region_id
    ),
    (
      select coalesce(array_agg(distinct pub.trip_year order by pub.trip_year desc), '{}'::smallint[])
      from published pub
      where pub.trip_year is not null
    ),
    (
      -- LEFT join + coalesce, the pattern 20260812110000 and 20260903120000
      -- already established: a row is either a curated tag reference or a
      -- contributor-typed label. Names are resolved without filtering on
      -- tags.active, matching 20260816100200's rule that a retired tag still
      -- renders rather than vanishing from a story that genuinely carried
      -- it. The WHERE keeps a row carrying neither out of the array, so a
      -- malformed row can never render as a blank chip.
      select coalesce(
        array_agg(distinct coalesce(tg.name, srt.custom_label)
                  order by coalesce(tg.name, srt.custom_label)),
        '{}'::text[]
      )
      from published pub
      join public.story_revision_tags srt on srt.revision_id = pub.revision_id
      left join public.tags tg on tg.id = srt.tag_id
      where coalesce(tg.name, srt.custom_label) is not null
    );
$$;

comment on function public.contributor_public_facts(uuid) is
  'The single definition of "what is publicly true about this contributor" -- published story count plus regions/trip years/tags derived from ONLY their public, published, approved, consent-granted revisions (Engineering Rules 10 and 12). Tags resolve a curated tag name OR the contributor-typed custom_label, per the LEFT-JOIN-and-coalesce rule public reads have used since 20260812110000. Internal: no grants, reachable only from the SECURITY DEFINER public RPCs.';
