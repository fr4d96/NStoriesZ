-- Contributors can name their own expense categories, and a breakdown is
-- capped at five rows.
--
-- WHAT THIS REVERSES, AND WHAT IT COSTS. 20260902110000 made this vocabulary
-- deliberately CLOSED, and said so at length: an expense only earns its keep
-- if it can be added up ACROSS stories, and "car" / "van stuff" / "vehicle"
-- are three unmergeable buckets for one thing. That reasoning has not become
-- wrong -- free text does weaken any future cross-story aggregate. It is a
-- product decision to accept that cost, taken knowingly.
--
-- Two things blunt it. The curated rows survive as SUGGESTIONS rather than a
-- ceiling, so a contributor who picks "Flights" still aggregates cleanly with
-- everyone else who picked "Flights"; only the typed tail is unmergeable.
-- And the five-row cap bounds how much tail there can be.
--
-- SHAPE COPIED FROM 20260812110000, not invented: a row is EITHER a
-- reference to an expense_categories row OR a contributor-authored label,
-- never both and never neither, enforced by a CHECK. That is exactly what
-- story_revision_tags/story_revision_work_types already do, so anyone who
-- has read those tables already knows how to read this one.
--
-- The surrogate `id` primary key from 20260902110100 means nothing has to be
-- rebuilt here -- unlike the tags migration, which had to replace a
-- composite PK containing the now-nullable FK.

alter table public.story_revision_expenses
  alter column category_id drop not null;

alter table public.story_revision_expenses
  add column custom_label text;

alter table public.story_revision_expenses
  add constraint story_revision_expenses_one_of check (
    (category_id is not null and custom_label is null)
    or (
      category_id is null
      and custom_label is not null
      and char_length(trim(custom_label)) > 0
      and char_length(custom_label) <= 60
    )
  );

-- The old constraint assumed a non-null category_id on every row. Replaced
-- with a PARTIAL unique index that keeps the same "one row per category per
-- revision" guarantee for reference rows, and simply does not apply to typed
-- ones -- set_revision_expenses() deletes and reinserts the whole set on
-- every save, and de-duplicates typed labels case-insensitively itself.
alter table public.story_revision_expenses
  drop constraint story_revision_expenses_one_per_category;

create unique index story_revision_expenses_unique_ref
  on public.story_revision_expenses (revision_id, category_id)
  where category_id is not null;

comment on column public.story_revision_expenses.custom_label is
  'A contributor-authored category name, set only when category_id is null. The curated expense_categories rows remain as suggestions; this is the typed tail.';

-- set_revision_expenses(): accepts typed labels, and caps the breakdown ----

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

  insert into public.story_revision_expenses
    (revision_id, category_id, custom_label, amount_nzd_cents, note)
  with input as (
    select
      nullif(rec ->> 'category_id', '')::uuid as category_id,
      left(nullif(trim(rec ->> 'custom_label'), ''), 60) as custom_label,
      nullif(rec ->> 'amount_nzd_cents', '')::integer as amount_nzd_cents,
      left(nullif(trim(rec ->> 'note'), ''), 120) as note,
      row_number() over () as ordinal
    from jsonb_array_elements(coalesce(p_expenses, '[]'::jsonb)) as rec
  ),
  cleaned as (
    select
      -- A row is one or the other, never both: an id wins if present, so a
      -- client sending both cannot smuggle a label onto a reference row and
      -- trip the CHECK.
      case when i.category_id is not null then i.category_id else null end as category_id,
      case when i.category_id is not null then null else i.custom_label end as custom_label,
      greatest(i.amount_nzd_cents, 0) as amount_nzd_cents,
      i.note,
      i.ordinal
    from input i
    where i.amount_nzd_cents is not null
      and (i.category_id is not null or i.custom_label is not null)
  ),
  -- One row per category, and one per typed label compared
  -- case-insensitively, so "Van" and "van" cannot both be stored.
  deduped as (
    select distinct on (
      coalesce(c.category_id::text, 'custom:' || lower(c.custom_label))
    ) c.*
    from cleaned c
    order by
      coalesce(c.category_id::text, 'custom:' || lower(c.custom_label)),
      c.ordinal
  )
  select p_revision_id, d.category_id, d.custom_label, d.amount_nzd_cents, d.note
  from deduped d
  order by d.ordinal
  -- The cap is enforced HERE, not only in the form: the RPC is reachable
  -- over PostgREST. Truncating rather than raising matches
  -- set_revision_tags()'s own 20-tag cap -- a background autosave should not
  -- start erroring because a client sent one row too many.
  limit 5;

  update public.stories set version = version + 1 where id = v_story_id;
end;
$$;

comment on function public.set_revision_expenses(uuid, integer, jsonb) is
  'Replaces a revision''s expense breakdown, at most FIVE rows. Each row is either a curated expense_categories reference or a contributor-typed label, never both -- an id wins if a client sends both. Drops rows with no amount (never storing a fake 0), clamps negatives, trims/truncates label and note, and dedupes by category or by case-folded label. The enforcing boundary, not the client.';

revoke execute on function public.set_revision_expenses(uuid, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.set_revision_expenses(uuid, integer, jsonb) to authenticated;
