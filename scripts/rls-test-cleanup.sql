-- NEVER run this against a production project. The default path below
-- deletes rows belonging to any story matching EITHER of two signals: the
-- 'rls-test-' slug prefix (tests/integration/story-rls.integration.test.ts's
-- `slug()` helper), or ownership by one of the fixed
-- `@whv-compass-test.example` test accounts (.env.test.local) -- added
-- 2026-08-16 because /stories/new no longer lets a caller's own title
-- reach `_generate_story_slug()` at creation time (it always creates an
-- "Untitled story" shell first; the real title, if any, is set afterward
-- on the edit page and never regenerates the slug), so an e2e spec that
-- creates a story through that real page and renames it afterward gets a
-- slug the first signal can no longer catch. The account-email signal is
-- exactly as safe as the slug one: every row it matches is owned by an
-- account that exists ONLY to be disposable test data, and no real
-- contributor can have that email domain. The commented-out full-truncate section
-- further down (gated by a second explicit env var,
-- SUPABASE_RLS_TEST_CONFIRM_FULL_TRUNCATE, checked by
-- scripts/run-rls-cleanup.mjs before it will even run it) removes ALL
-- story-domain data. Neither path touches auth.users, profiles, user_roles,
-- or contributors — the fixed test-account pool must survive every cleanup
-- run.
--
-- Run only via `npm run test:rls:cleanup` (which shells out to
-- `supabase db query --file scripts/rls-test-cleanup.sql --linked`). As of
-- 2026-08-16 that command also runs automatically as npm's `posttest:rls`
-- hook after a SUCCESSFUL `npm run test:rls` — see the reasoning in
-- scripts/run-rls-cleanup.mjs's header. A FAILED run does not trigger it
-- (npm skips post* hooks on non-zero exit), so a broken run's fixtures
-- survive for debugging.
--
-- Deletes in dependency order rather than relying on cascade: every
-- structural parent/child FK in the story domain is deliberately
-- `on delete restrict` (see docs/architecture.md "Deletion policy" —
-- no ordinary hard deletion is supported by design), so a plain
-- `delete from stories` alone would fail with a foreign-key violation.
--
-- Prompt 5 addition: `_protect_revision_child_immutability()` (and
-- story_revisions_protect_immutable_content()) block writes to a
-- non-draft revision's children/content for every ordinary caller,
-- including this script -- a real gap found live the first time a test
-- fixture attached work_types/tags to a revision and then approved it
-- before cleanup ran. That protection exists for ordinary application
-- mutation, not for this already-guarded, dev-only teardown script, so
-- triggers are disabled for the session around the deletes below and
-- restored immediately after.
--
-- READ THIS BEFORE ADDING A CHILD TABLE. `replica` also disables FOREIGN KEY
-- enforcement, which is what makes the ordering below possible -- and it
-- means a child table missing from this script does NOT raise. The stories
-- delete simply succeeds and leaves the child rows ORPHANED, pointing at ids
-- that no longer exist, against a constraint that is validated and enabled
-- and was never consulted.
--
-- That is not hypothetical: story_revision_expenses (20260902110100) and
-- story_takedown_requests (20260903100000) were both added without touching
-- this file, and the second one left 9 orphaned rows across several runs
-- before anyone noticed. Nothing errored, because the one mechanism that
-- would have complained is switched off three lines from here.
--
-- So this script is a fourth enumeration site for per-story/per-revision
-- child tables, alongside create_next_draft_revision() (copies them),
-- delete_draft_story() (deletes them) and the migration that creates them.
-- Adding a table means editing all of them in the same change -- and this
-- is the only one of the four that will not tell you when you forget.
set session_replication_role = replica;

-- Prompt 6 Stage 1: story_report_notes references story_reports with
-- on delete restrict -- must go first.
with target_stories as (
  select id from public.stories
  where slug like 'rls-test-%'
     or owner_user_id in (
       select id from auth.users where email like '%@whv-compass-test.example'
     )
), target_reports as (
  select id from public.story_reports where story_id in (select id from target_stories)
)
delete from public.story_report_notes where report_id in (select id from target_reports);

with target_stories as (
  select id from public.stories
  where slug like 'rls-test-%'
     or owner_user_id in (
       select id from auth.users where email like '%@whv-compass-test.example'
     )
), target_revisions as (
  select id from public.story_revisions where story_id in (select id from target_stories)
)
delete from public.story_reports where story_id in (select id from target_stories);

with target_stories as (
  select id from public.stories
  where slug like 'rls-test-%'
     or owner_user_id in (
       select id from auth.users where email like '%@whv-compass-test.example'
     )
), target_revisions as (
  select id from public.story_revisions where story_id in (select id from target_stories)
), target_actions as (
  select id from public.moderation_actions where revision_id in (select id from target_revisions)
)
delete from public.moderation_action_notes where action_id in (select id from target_actions);

with target_stories as (
  select id from public.stories
  where slug like 'rls-test-%'
     or owner_user_id in (
       select id from auth.users where email like '%@whv-compass-test.example'
     )
), target_revisions as (
  select id from public.story_revisions where story_id in (select id from target_stories)
)
delete from public.moderation_actions where revision_id in (select id from target_revisions);

delete from public.editorial_actions where story_id in (
  select id from public.stories
  where slug like 'rls-test-%'
     or owner_user_id in (
       select id from auth.users where email like '%@whv-compass-test.example'
     )
);

with target_stories as (
  select id from public.stories
  where slug like 'rls-test-%'
     or owner_user_id in (
       select id from auth.users where email like '%@whv-compass-test.example'
     )
), target_consents as (
  select id from public.story_publication_consents where story_id in (select id from target_stories)
)
delete from public.story_publication_consent_notes where consent_id in (select id from target_consents);

delete from public.story_publication_consents where story_id in (
  select id from public.stories
  where slug like 'rls-test-%'
     or owner_user_id in (
       select id from auth.users where email like '%@whv-compass-test.example'
     )
);

with target_stories as (
  select id from public.stories
  where slug like 'rls-test-%'
     or owner_user_id in (
       select id from auth.users where email like '%@whv-compass-test.example'
     )
), target_revisions as (
  select id from public.story_revisions where story_id in (select id from target_stories)
)
delete from public.story_revision_media where revision_id in (select id from target_revisions);

with target_stories as (
  select id from public.stories
  where slug like 'rls-test-%'
     or owner_user_id in (
       select id from auth.users where email like '%@whv-compass-test.example'
     )
), target_revisions as (
  select id from public.story_revisions where story_id in (select id from target_stories)
)
delete from public.story_revision_locations where revision_id in (select id from target_revisions);

with target_stories as (
  select id from public.stories
  where slug like 'rls-test-%'
     or owner_user_id in (
       select id from auth.users where email like '%@whv-compass-test.example'
     )
), target_revisions as (
  select id from public.story_revisions where story_id in (select id from target_stories)
)
delete from public.story_revision_work_types where revision_id in (select id from target_revisions);

with target_stories as (
  select id from public.stories
  where slug like 'rls-test-%'
     or owner_user_id in (
       select id from auth.users where email like '%@whv-compass-test.example'
     )
), target_revisions as (
  select id from public.story_revisions where story_id in (select id from target_stories)
)
delete from public.story_revision_tags where revision_id in (select id from target_revisions);

with target_stories as (
  select id from public.stories
  where slug like 'rls-test-%'
     or owner_user_id in (
       select id from auth.users where email like '%@whv-compass-test.example'
     )
), target_revisions as (
  select id from public.story_revisions where story_id in (select id from target_stories)
)
delete from public.story_revision_editor_notes where revision_id in (select id from target_revisions);

-- 20260902110100: story_revision_expenses references story_revisions with
-- on delete restrict, like every other per-revision child table -- so it
-- must be cleared before the story_revisions delete below or that delete
-- raises. Added when the table was, rather than the run after someone
-- noticed the suite had stopped cleaning up after itself.
with target_stories as (
  select id from public.stories
  where slug like 'rls-test-%'
     or owner_user_id in (
       select id from auth.users where email like '%@whv-compass-test.example'
     )
), target_revisions as (
  select id from public.story_revisions where story_id in (select id from target_stories)
)
delete from public.story_revision_expenses where revision_id in (select id from target_revisions);

-- Prompt 4: story_media_public_copy_attempts references both
-- story_publication_attempts and story_revisions/story_media with
-- on delete restrict — must go first. story_publication_attempts itself
-- references story_revisions the same way.
with target_stories as (
  select id from public.stories
  where slug like 'rls-test-%'
     or owner_user_id in (
       select id from auth.users where email like '%@whv-compass-test.example'
     )
), target_revisions as (
  select id from public.story_revisions where story_id in (select id from target_stories)
)
delete from public.story_media_public_copy_attempts
  where revision_id in (select id from target_revisions);

with target_stories as (
  select id from public.stories
  where slug like 'rls-test-%'
     or owner_user_id in (
       select id from auth.users where email like '%@whv-compass-test.example'
     )
), target_revisions as (
  select id from public.story_revisions where story_id in (select id from target_stories)
)
delete from public.story_publication_attempts
  where revision_id in (select id from target_revisions);

-- Clear the forward pointers before deleting revisions (they reference
-- story_revisions with on delete restrict too).
update public.stories
  set current_draft_revision_id = null, published_revision_id = null
  where slug like 'rls-test-%'
     or owner_user_id in (
       select id from auth.users where email like '%@whv-compass-test.example'
     );

delete from public.story_revisions where story_id in (
  select id from public.stories
  where slug like 'rls-test-%'
     or owner_user_id in (
       select id from auth.users where email like '%@whv-compass-test.example'
     )
);

delete from public.story_media where story_id in (
  select id from public.stories
  where slug like 'rls-test-%'
     or owner_user_id in (
       select id from auth.users where email like '%@whv-compass-test.example'
     )
);

-- 20260903100000: story_takedown_requests references stories with
-- on delete restrict -- same rule, same reason, before the stories delete.
delete from public.story_takedown_requests where story_id in (
  select id from public.stories
  where slug like 'rls-test-%'
     or owner_user_id in (
       select id from auth.users where email like '%@whv-compass-test.example'
     )
);

-- 20260911100000: notifications reference stories/story_revisions with
-- on delete CASCADE (the one deliberate exception -- see that migration's
-- header), which would clean itself up anywhere else. Not here: `replica`
-- switches off foreign-key enforcement, and a cascade is part of the
-- constraint it switches off, so without this line every run leaves one
-- orphaned inbox row per moderator per submitted fixture.
delete from public.notifications where story_id in (
  select id from public.stories
  where slug like 'rls-test-%'
     or owner_user_id in (
       select id from auth.users where email like '%@whv-compass-test.example'
     )
);

-- Prompt 6 Stage 1: story_publication_state_actions references stories
-- with on delete restrict -- must go before the stories delete.
delete from public.story_publication_state_actions where story_id in (
  select id from public.stories
  where slug like 'rls-test-%'
     or owner_user_id in (
       select id from auth.users where email like '%@whv-compass-test.example'
     )
);

delete from public.stories
  where slug like 'rls-test-%'
     or owner_user_id in (
       select id from auth.users where email like '%@whv-compass-test.example'
     );

-- Lookup-table fixtures (regions/destinations/work_types/tags): the same
-- slug() helper (tests/integration/story-rls.integration.test.ts:140) also
-- names these `rls-test-<runId>-<label>`, but nothing deleted them before
-- this addition -- every run left its fixture rows behind permanently
-- (found 46 duplicate "RLS Test Region A" rows accumulated on the hosted
-- dev project). destinations first: region_id references regions
-- on delete restrict, same reasoning as the story-domain deletes above.
delete from public.destinations where slug like 'rls-test-%';
delete from public.regions where slug like 'rls-test-%';
delete from public.work_types where slug like 'rls-test-%';
delete from public.tags where slug like 'rls-test-%';

set session_replication_role = default;

-- ---------------------------------------------------------------------
-- Full-truncate fallback — DISABLED BY DEFAULT. Uncomment only if scoped
-- cleanup above isn't enough (e.g. leftover data from a run that crashed
-- mid-way and used a slug outside the rls-test- convention). Requires
-- SUPABASE_RLS_TEST_CONFIRM_FULL_TRUNCATE to also be set when running via
-- npm run test:rls:cleanup -- --full.
-- ---------------------------------------------------------------------
-- truncate
--   public.stories,
--   public.story_revisions,
--   public.story_revision_locations,
--   public.story_revision_work_types,
--   public.story_revision_tags,
--   public.story_revision_editor_notes,
--   public.story_media,
--   public.story_revision_media,
--   public.story_publication_consents,
--   public.story_publication_consent_notes,
--   public.moderation_actions,
--   public.moderation_action_notes,
--   public.story_reports,
--   public.editorial_actions,
--   public.story_publication_attempts,
--   public.story_media_public_copy_attempts
--   cascade;
