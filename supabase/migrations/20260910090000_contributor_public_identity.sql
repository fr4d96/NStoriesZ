-- The public contributor identity moves onto `contributors`, and the public
-- profile starts showing facts derived from the contributor's own published
-- stories.
--
-- WHAT WAS ACTUALLY BROKEN. /contributors/[slug] renders
-- get_public_contributor(), which returns `contributors.display_name` and
-- `contributors.bio`. Nothing in the application has ever written
-- `contributors.bio` -- the account page's Profile tab writes
-- `profiles.bio` (app/(contributor)/actions.ts updateProfileAction). So a
-- self-service contributor could write a bio, choose an avatar emoji and
-- tick "make my profile public", and their public page still showed a name,
-- a grey letter circle and a story count. The same split gave them two
-- different "public" toggles and two different slugs, only one of each
-- reaching a real URL. docs/implementation-status.md "Known assumptions" #8
-- recorded the split as an assumption and asked for it to be revisited if
-- the product intent was a single public profile. It was.
--
-- WHY `contributors` WINS AND NOT `profiles`. A contributor record can
-- exist with linked_user_id NULL -- that is how editors import the founding
-- catalogue for people who never signed up (see this table's own comment,
-- and the "contributors: staff create unlinked contributor records"
-- policy). `profiles.id` references auth.users, so a profile CANNOT exist
-- for those people. Hanging the public identity off profiles would mean
-- imported contributors are structurally incapable of ever having a bio or
-- an avatar. So: `contributors` is the public face, `profiles` stays the
-- private account record. Engineering Rule 4's separation is about
-- user-editable profile data vs protected role/permission data (profiles vs
-- user_roles) -- it does not require this particular split and is untouched
-- by this change.

alter table public.contributors
  add column avatar_emoji text,
  add column home_country_code text;

-- Same fixed set as profiles (20260807220000_profile_avatar_emoji.sql) and
-- lib/avatar.ts. Duplicated rather than shared for the reason lib/avatar.ts
-- already documents: Zod gives the friendly form error, the CHECK is the
-- non-bypassable source of truth (Engineering Rule 3). Changing the set
-- means a new migration touching BOTH constraints.
alter table public.contributors
  add constraint contributors_avatar_emoji_allowed check (
    avatar_emoji is null or avatar_emoji in (
      '🌏', '🧳', '🎒', '🥾', '🍏', '🍇', '🐑', '🚜', '⛰️', '🌊',
      '🏕️', '☕', '🚐', '🌅', '🦘', '🥝', '🏔️', '🌲', '🛶', '🏄',
      '🐧', '🦙', '🌻', '🍷'
    )
  );

-- NULLABLE, and deliberately NOT defaulted to 'MY' the way profiles.
-- home_country_code is. That default exists to smooth onboarding on a form
-- the user is looking at and can correct. This column is published under a
-- real person's name, including for editor-imported contributors who were
-- never asked. An unknown home country must render as absent, never as a
-- guess presented as fact.
alter table public.contributors
  add constraint contributors_home_country_code_format check (
    home_country_code is null or home_country_code ~ '^[A-Z]{2}$'
  );

comment on column public.contributors.avatar_emoji is
  'Public avatar, chosen from the fixed set in the CHECK constraint + lib/avatar.ts. Null falls back to the initial-letter treatment.';
comment on column public.contributors.home_country_code is
  'ISO 3166-1 alpha-2, stored as data (no countries reference table exists). Nullable on purpose: unknown must render as absent, not as a default asserted about a real person.';

-- Backfill the identity self-service contributors already filled in on the
-- wrong table, so nobody has to retype a bio they already wrote. Only where
-- the contributor field is still empty, so an editor-set bio is never
-- overwritten by a linked user's account bio.
--
-- home_country_code is DELIBERATELY NOT BACKFILLED, even though the column
-- exists on both tables. profiles.home_country_code is NOT NULL DEFAULT
-- 'MY' -- so for every user who never opened that dropdown, the value is an
-- onboarding default, not something they told us. Copying it would publish
-- "from Malaysia" under the name of real people who never said so, which is
-- the exact failure the new column's nullability was chosen to prevent.
-- Contributors state it deliberately in the new form or it stays absent.
update public.contributors c
set
  bio = coalesce(c.bio, p.bio),
  avatar_emoji = coalesce(c.avatar_emoji, p.avatar_emoji)
from public.profiles p
where p.id = c.linked_user_id
  and (c.bio is null or c.avatar_emoji is null);

-- No RLS changes. RLS is row-scoped, not column-scoped, so the existing
-- "contributors: owner or staff update contributor record" policy already
-- covers the new columns, and contributors_protect_privileged_fields()
-- guards only linked_user_id/created_by/archival -- none of which this
-- touches.

-- --------------------------------------------------------------------------
-- The public-visibility invariant, defined exactly once.
-- --------------------------------------------------------------------------
--
-- list_public_contributors() and get_public_contributor() each carried
-- their own copy of the same "public + published + approved revision +
-- consent granted + not revoked" lateral join. Adding derived facts to both
-- would have made that three copies in two functions, and Engineering Rules
-- 10 and 12 fail CLOSED only if every copy stays in step -- one forgotten
-- `consent_revoked_at is null` and a withdrawn story leaks back as a
-- region chip on someone's byline page. So the invariant now lives in one
-- SECURITY DEFINER helper and both callers read from it.
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
      -- Names resolved without filtering on tags.active, matching
      -- 20260816100200's rule that a retired tag still renders rather than
      -- silently vanishing from a story that genuinely carried it.
      select coalesce(array_agg(distinct tg.name order by tg.name), '{}'::text[])
      from published pub
      join public.story_revision_tags srt on srt.revision_id = pub.revision_id
      join public.tags tg on tg.id = srt.tag_id
    );
$$;

comment on function public.contributor_public_facts(uuid) is
  'The single definition of "what is publicly true about this contributor" -- published story count plus regions/trip years/tags derived from ONLY their public, published, approved, consent-granted revisions (Engineering Rules 10 and 12). Internal: no grants, reachable only from the SECURITY DEFINER public RPCs below.';

revoke all on function public.contributor_public_facts(uuid) from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- The two public RPCs, rebuilt on the helper.
-- --------------------------------------------------------------------------
--
-- These are DROPped rather than CREATE OR REPLACEd because both gain
-- columns, and Postgres refuses to replace a function whose OUT parameters
-- changed ("cannot change return type of existing function"). A DROP takes
-- the function's grants with it, so both grants are re-applied below --
-- the same trap 20260909130000_generalise_rate_limits.sql hit and
-- documented. Getting this wrong here fails loudly (anon loses execute, the
-- contributor pages 500) rather than silently, but it still has to be done.

drop function if exists public.list_public_contributors(text, uuid, integer);
drop function if exists public.get_public_contributor(text);

-- Directory inclusion rules are unchanged from
-- 20260805100300_public_contributor_functions.sql and still deliberately
-- narrower than public_status = 'public' alone: a usable slug, at least one
-- published story, and never attribution_type = 'anonymous' (someone who
-- chose anonymity does not also get a named byline page).
create or replace function public.list_public_contributors(
  p_cursor_display_name text default null,
  p_cursor_id uuid default null,
  p_limit integer default 20
)
returns table (
  contributor_id uuid,
  public_slug text,
  display_name text,
  bio text,
  avatar_emoji text,
  home_country_code text,
  published_story_count bigint,
  regions text[],
  trip_years smallint[],
  tags text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
begin
  return query
    select
      c.id, c.public_slug, c.display_name, c.bio, c.avatar_emoji,
      c.home_country_code, f.published_story_count, f.regions, f.trip_years,
      f.tags
    from public.contributors c
    join lateral public.contributor_public_facts(c.id) f on true
    where c.public_status = 'public'
      and c.public_slug is not null
      and c.attribution_type <> 'anonymous'
      and f.published_story_count > 0
      and (
        p_cursor_display_name is null
        or (lower(c.display_name), c.id) > (lower(p_cursor_display_name), p_cursor_id)
      )
    order by lower(c.display_name) asc, c.id asc
    limit v_limit;
end;
$$;

revoke execute on function public.list_public_contributors(text, uuid, integer) from public, anon, authenticated;
grant execute on function public.list_public_contributors(text, uuid, integer) to anon, authenticated;

create or replace function public.get_public_contributor(p_slug text)
returns table (
  contributor_id uuid,
  public_slug text,
  display_name text,
  bio text,
  avatar_emoji text,
  home_country_code text,
  published_story_count bigint,
  regions text[],
  trip_years smallint[],
  tags text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
    select
      c.id, c.public_slug, c.display_name, c.bio, c.avatar_emoji,
      c.home_country_code, f.published_story_count, f.regions, f.trip_years,
      f.tags
    from public.contributors c
    join lateral public.contributor_public_facts(c.id) f on true
    where c.public_slug = p_slug
      and c.public_status = 'public'
      and c.attribution_type <> 'anonymous'
      and f.published_story_count > 0;
end;
$$;

revoke execute on function public.get_public_contributor(text) from public, anon, authenticated;
grant execute on function public.get_public_contributor(text) to anon, authenticated;
