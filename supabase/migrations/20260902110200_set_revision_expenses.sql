-- Writer for a revision's expense breakdown. Structurally identical to
-- set_revision_tags() / set_revision_locations()
-- (20260803090700_story_lifecycle_functions.sql, latest tag revision
-- 20260816100000): _authorize_revision_edit, optimistic-version check,
-- delete-then-insert the whole set, bump stories.version. Nothing here
-- invents a new authoring pattern.
--
-- JSONB, not three parallel arrays (p_category_ids uuid[], p_amounts
-- integer[], p_notes text[]). Parallel arrays have no way to say "these
-- three lists are the same length" -- a client bug that drops one element
-- silently reassigns every amount after it to the wrong category, and
-- nothing raises. One object per row cannot misalign.
--
-- Each element: { category_id, amount_nzd_cents, note }.
--
-- RE-VALIDATED HERE, not trusted from the client (Engineering Rule 2). The
-- form applies the same rules for a fast, friendly experience; this is the
-- boundary that actually enforces them:
--   * a row with no category_id is dropped -- there is nothing to record
--     it against;
--   * a row with no amount is dropped rather than stored as 0. This is the
--     one that matters for data quality: "I didn't record it" and "it cost
--     nothing" are different claims, and a fake zero corrupts every future
--     average across stories (see this table's own migration header);
--   * a negative amount is clamped to 0 rather than rejected, so a stray
--     minus sign cannot fail an autosave mid-typing;
--   * a note is trimmed, emptied to null, and cut to the column's 120-char
--     ceiling -- again, a too-long note should not be able to make a
--     background save start erroring;
--   * duplicate categories collapse to the first occurrence, which is also
--     what story_revision_expenses_one_per_category would otherwise raise
--     on.
--
-- Amounts are NZD cents (integer). The parent revision is already
-- NZD-only; the column name carries it.

create or replace function public.set_revision_expenses(
  p_revision_id uuid, p_expected_version integer, p_expenses jsonb
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

  delete from public.story_revision_expenses where revision_id = p_revision_id;

  insert into public.story_revision_expenses (revision_id, category_id, amount_nzd_cents, note)
  with input as (
    select
      nullif(rec ->> 'category_id', '')::uuid as category_id,
      nullif(rec ->> 'amount_nzd_cents', '')::integer as amount_nzd_cents,
      left(nullif(trim(rec ->> 'note'), ''), 120) as note
    from jsonb_array_elements(coalesce(p_expenses, '[]'::jsonb)) as rec
  ),
  cleaned as (
    select
      i.category_id,
      greatest(i.amount_nzd_cents, 0) as amount_nzd_cents,
      i.note
    from input i
    where i.category_id is not null
      and i.amount_nzd_cents is not null
  ),
  deduped as (
    select distinct on (c.category_id) c.category_id, c.amount_nzd_cents, c.note
    from cleaned c
    order by c.category_id
  )
  select p_revision_id, d.category_id, d.amount_nzd_cents, d.note from deduped d;

  update public.stories set version = version + 1 where id = v_story_id;
end;
$$;

comment on function public.set_revision_expenses(uuid, integer, jsonb) is
  'Replaces a revision''s per-category expense breakdown. Same edit-rights rule and optimistic-version check as every other authoring RPC. Drops rows with no category or no amount (never storing a fake 0), clamps negatives, trims/truncates notes, and dedupes by category -- the enforcing boundary, not the client.';

revoke execute on function public.set_revision_expenses(uuid, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.set_revision_expenses(uuid, integer, jsonb) to authenticated;
