-- "What it actually cost", across stories -- the reason any of this data was
-- collected.
--
-- WHAT THIS IS NOT. It is not a budget calculator, and the difference is not
-- cosmetic. docs/product-spec.md lists budgeting tools and anything that
-- reads as personalised financial advice under MVP non-goals, and Engineering
-- Rule 17 makes every story a personal account. So this function reports what
-- a named number of real people RECORDED, in the past, about trips they
-- actually took. It takes no input about the reader, predicts nothing, and
-- must never be presented as an estimate for anyone's own trip.
--
-- THE SAME VISIBILITY PREDICATE AS list_published_stories(), copied rather
-- than loosened: public visibility, published lifecycle, an `approved`
-- published revision, a granted publication consent for THAT revision, and
-- consent_revoked_at still null. An aggregate is exactly the sort of query
-- where a quietly wider WHERE clause would leak withdrawn or unapproved
-- content without anyone noticing a specific story appear (Rules 10-12).
--
-- MINIMUM SAMPLE OF 5, per bucket, everywhere. Two reasons, both real:
--   * A "median" of two stories is not a median, it is two numbers with a
--     line drawn between them, and printing it as a statistic is a lie about
--     how much is known.
--   * With one or two contributors in a bucket, publishing its median
--     publishes an individual's spending against a region or a category --
--     re-identifiable by anyone who can see which stories are in it. The
--     floor is a privacy control as much as a statistical one.
-- Buckets under the floor are omitted entirely rather than shown as zero,
-- which would read as "nobody spent anything here".
--
-- MEDIAN AND QUARTILES, NOT MEAN. Trip costs are long-tailed -- one person
-- who bought a van distorts a mean badly at these sample sizes. p25-p75 says
-- more honestly "half the people who reported are in this range".

create or replace function public.get_expense_aggregates()
returns table (
  overall jsonb,
  per_month jsonb,
  by_region jsonb,
  by_category jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  -- Below this many stories a bucket is withheld. See the header.
  v_min_sample constant integer := 5;
  -- Average Gregorian month, identical to lib/story/expense-per-month.ts, so
  -- a per-month figure here and one on a story page cannot disagree.
  v_days_per_month constant numeric := 30.436875;
begin
  return query
  with published as (
    select s.id as story_id, r.id as revision_id,
           r.total_expense_nzd_cents as total_cents,
           r.trip_start_date, r.trip_end_date
    from public.stories s
    join public.story_revisions r
      on r.id = s.published_revision_id and r.story_id = s.id and r.revision_status = 'approved'
    join lateral (
      select * from public.story_publication_consents
      where story_id = s.id and revision_id = s.published_revision_id and consent_status = 'granted'
      limit 1
    ) con on true
    where s.visibility = 'public'
      and s.lifecycle_status = 'published'
      and s.consent_revoked_at is null
  ),
  with_total as (
    select * from published where total_cents is not null and total_cents > 0
  ),
  -- Only trips with a real range, and long enough for a monthly figure to
  -- describe something the contributor lived through -- the same 28-day floor
  -- lib/story/expense-per-month.ts applies, for the same reason: $3,000 over
  -- 10 days is not "$9,132 a month".
  with_months as (
    select total_cents,
           (trip_end_date - trip_start_date + 1) as days
    from with_total
    where trip_start_date is not null
      and trip_end_date is not null
      and trip_end_date >= trip_start_date
      and (trip_end_date - trip_start_date + 1) >= 28
  )
  select
    (
      select case when count(*) >= v_min_sample then jsonb_build_object(
        'story_count', count(*),
        'median_cents', round(percentile_cont(0.5) within group (order by total_cents))::bigint,
        'p25_cents', round(percentile_cont(0.25) within group (order by total_cents))::bigint,
        'p75_cents', round(percentile_cont(0.75) within group (order by total_cents))::bigint
      ) else null end
      from with_total
    ),
    (
      select case when count(*) >= v_min_sample then jsonb_build_object(
        'story_count', count(*),
        'median_cents', round(percentile_cont(0.5) within group (
          order by total_cents / (days / v_days_per_month)))::bigint,
        'p25_cents', round(percentile_cont(0.25) within group (
          order by total_cents / (days / v_days_per_month)))::bigint,
        'p75_cents', round(percentile_cont(0.75) within group (
          order by total_cents / (days / v_days_per_month)))::bigint
      ) else null end
      from with_months
    ),
    (
      select coalesce(jsonb_agg(b order by b->>'region_name'), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'region_name', reg.name,
          'story_count', count(distinct wt.story_id),
          'median_cents', round(percentile_cont(0.5) within group (order by wt.total_cents))::bigint
        ) as b
        from with_total wt
        join public.story_revision_locations loc on loc.revision_id = wt.revision_id
        join public.regions reg on reg.id = loc.region_id
        group by reg.id, reg.name
        having count(distinct wt.story_id) >= v_min_sample
      ) region_rows
    ),
    (
      select coalesce(jsonb_agg(b order by (b->>'story_count')::int desc, b->>'name'), '[]'::jsonb)
      from (
        -- Case-folded key so "Van" and "van" are one bucket. Contributors can
        -- type their own categories (20260903110000), which fragments this cut
        -- by design -- an accepted cost of that decision, and the reason the
        -- curated rows still exist as suggestions.
        select jsonb_build_object(
          'name', min(coalesce(ec.name, e.custom_label)),
          'story_count', count(distinct wt.story_id),
          'median_cents', round(percentile_cont(0.5) within group (order by e.amount_nzd_cents))::bigint
        ) as b
        from published wt
        join public.story_revision_expenses e on e.revision_id = wt.revision_id
        left join public.expense_categories ec on ec.id = e.category_id
        where e.amount_nzd_cents > 0
        group by lower(coalesce(ec.name, e.custom_label))
        having count(distinct wt.story_id) >= v_min_sample
      ) category_rows
    );
end;
$$;

comment on function public.get_expense_aggregates() is
  'What real contributors RECORDED spending, across published stories only -- not a budget tool and not an estimate for anyone (product-spec MVP non-goals, Engineering Rule 17). Same visibility predicate as list_published_stories(). Every bucket is withheld below 5 stories: a median of two is not a statistic, and it would publish an individual''s spending. Median with p25-p75 rather than a mean, because trip costs are long-tailed at these sample sizes.';

revoke execute on function public.get_expense_aggregates() from public, anon, authenticated;
grant execute on function public.get_expense_aggregates() to anon, authenticated;
