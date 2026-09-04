-- A story revision's optional per-category expense breakdown.
--
-- Keyed off revision_id, NOT story_id -- the same rule every per-revision
-- child table in this schema follows (20260803090300_story_revision_
-- relations.sql). An unapproved edit lives on its own revision, so a
-- contributor rewriting their budget can never alter what a public read of
-- the PUBLISHED revision returns (Engineering Rules 10 and 11).
--
-- RELATIONSHIP TO story_revisions.total_expense_nzd_cents: none, on
-- purpose. The lump total stays the headline number and stays independent
-- -- no generated column, no CHECK tying the two together. A partial
-- breakdown is the normal case, not an error: someone who remembers what
-- their flights and their van cost but not their groceries should be able
-- to say so. "The categories add up to more than the stated total" is a
-- judgement call for a human, so it surfaces as an advisory warning in
-- lib/story/content-quality-checks.ts, which never blocks anything.
--
-- NZD ONLY, carried in the column name. The parent revision is already
-- constrained to NZD (story_revisions_currency_nzd_only), and a breakdown
-- in a second currency under an NZD total would be nonsense.
--
-- NO ROW FOR AN EMPTY AMOUNT. set_revision_expenses() drops a row whose
-- amount the contributor left blank rather than storing 0. "I didn't
-- record it" and "it cost nothing" are different claims, and a fake zero
-- would quietly drag every future average down.
--
-- NO TRIP-LENGTH COLUMN: trip_start_date/trip_end_date already live on the
-- revision, so a per-week or per-month figure is derived, never stored
-- twice and never able to disagree with the dates.

create table public.story_revision_expenses (
  -- Surrogate primary key with the one-per-category rule as a separate
  -- UNIQUE, rather than a composite PK on (revision_id, category_id). Same
  -- data either way, but the constraint can be dropped or redefined later
  -- (e.g. if multiple dated entries per category ever make sense) without
  -- rebuilding the foreign keys that would otherwise point at it.
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.story_revisions (id) on delete restrict,
  category_id uuid not null references public.expense_categories (id) on delete restrict,
  amount_nzd_cents integer not null,
  note text,
  constraint story_revision_expenses_amount_non_negative check (amount_nzd_cents >= 0),
  constraint story_revision_expenses_note_length check (
    note is null or char_length(note) between 1 and 120
  ),
  constraint story_revision_expenses_one_per_category unique (revision_id, category_id)
);

create index story_revision_expenses_revision_id_idx
  on public.story_revision_expenses (revision_id);
create index story_revision_expenses_category_id_idx
  on public.story_revision_expenses (category_id);

-- The SHARED trigger function from 20260803090300, reused rather than
-- reimplemented: every per-revision child table keys off a `revision_id`
-- column, so one function already covers this one. It refuses any write
-- whose revision is not currently editable, backing up (not replacing)
-- set_revision_expenses()'s own _authorize_revision_edit() check.
create trigger story_revision_expenses_protect_immutability
  before insert or update or delete on public.story_revision_expenses
  for each row
  execute function public._protect_revision_child_immutability();

alter table public.story_revision_expenses enable row level security;
-- No policies -- every access is a SECURITY DEFINER function.

-- REQUIRED, not belt-and-braces. Supabase's default project setup grants
-- broad table privileges to anon/authenticated on every table created in
-- the public schema, independent of RLS -- see
-- 20260803090900_lock_down_story_domain_grants.sql, which had to go back
-- and revoke them from all fourteen story-domain tables after the RLS
-- integration suite caught it. A new table starts in exactly that state,
-- so it is revoked here, in the same migration that creates it.
revoke all on public.story_revision_expenses from public, anon, authenticated;

comment on table public.story_revision_expenses is
  'Optional per-category expense breakdown for one story revision. Independent of story_revisions.total_expense_nzd_cents (partial breakdowns are valid and normal); written only by set_revision_expenses(). No grants, no policies -- SECURITY DEFINER functions are the only way in.';
