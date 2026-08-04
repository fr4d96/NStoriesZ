-- NEVER run this against a production project. The default path below only
-- deletes rows belonging to stories matching the 'rls-test-' slug prefix
-- that the integration suite (tests/integration/story-rls.integration.test.ts)
-- uses for everything it creates. The commented-out full-truncate section
-- further down (gated by a second explicit env var,
-- SUPABASE_RLS_TEST_CONFIRM_FULL_TRUNCATE, checked by
-- scripts/run-rls-cleanup.mjs before it will even run it) removes ALL
-- story-domain data. Neither path touches auth.users, profiles, user_roles,
-- or contributors — the fixed test-account pool must survive every cleanup
-- run.
--
-- Run only via `npm run test:rls:cleanup` (which shells out to
-- `supabase db query --file scripts/rls-test-cleanup.sql --linked`), never
-- automatically.
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
-- mutation, not for this already-guarded, already-manual, dev-only
-- teardown script, so triggers are disabled for the session around the
-- deletes below and restored immediately after.
set session_replication_role = replica;

with target_stories as (
  select id from public.stories where slug like 'rls-test-%'
), target_revisions as (
  select id from public.story_revisions where story_id in (select id from target_stories)
)
delete from public.story_reports where story_id in (select id from target_stories);

with target_stories as (
  select id from public.stories where slug like 'rls-test-%'
), target_revisions as (
  select id from public.story_revisions where story_id in (select id from target_stories)
), target_actions as (
  select id from public.moderation_actions where revision_id in (select id from target_revisions)
)
delete from public.moderation_action_notes where action_id in (select id from target_actions);

with target_stories as (
  select id from public.stories where slug like 'rls-test-%'
), target_revisions as (
  select id from public.story_revisions where story_id in (select id from target_stories)
)
delete from public.moderation_actions where revision_id in (select id from target_revisions);

delete from public.editorial_actions where story_id in (
  select id from public.stories where slug like 'rls-test-%'
);

with target_stories as (
  select id from public.stories where slug like 'rls-test-%'
), target_consents as (
  select id from public.story_publication_consents where story_id in (select id from target_stories)
)
delete from public.story_publication_consent_notes where consent_id in (select id from target_consents);

delete from public.story_publication_consents where story_id in (
  select id from public.stories where slug like 'rls-test-%'
);

with target_stories as (
  select id from public.stories where slug like 'rls-test-%'
), target_revisions as (
  select id from public.story_revisions where story_id in (select id from target_stories)
)
delete from public.story_revision_media where revision_id in (select id from target_revisions);

with target_stories as (
  select id from public.stories where slug like 'rls-test-%'
), target_revisions as (
  select id from public.story_revisions where story_id in (select id from target_stories)
)
delete from public.story_revision_locations where revision_id in (select id from target_revisions);

with target_stories as (
  select id from public.stories where slug like 'rls-test-%'
), target_revisions as (
  select id from public.story_revisions where story_id in (select id from target_stories)
)
delete from public.story_revision_work_types where revision_id in (select id from target_revisions);

with target_stories as (
  select id from public.stories where slug like 'rls-test-%'
), target_revisions as (
  select id from public.story_revisions where story_id in (select id from target_stories)
)
delete from public.story_revision_tags where revision_id in (select id from target_revisions);

with target_stories as (
  select id from public.stories where slug like 'rls-test-%'
), target_revisions as (
  select id from public.story_revisions where story_id in (select id from target_stories)
)
delete from public.story_revision_editor_notes where revision_id in (select id from target_revisions);

-- Prompt 4: story_media_public_copy_attempts references both
-- story_publication_attempts and story_revisions/story_media with
-- on delete restrict — must go first. story_publication_attempts itself
-- references story_revisions the same way.
with target_stories as (
  select id from public.stories where slug like 'rls-test-%'
), target_revisions as (
  select id from public.story_revisions where story_id in (select id from target_stories)
)
delete from public.story_media_public_copy_attempts
  where revision_id in (select id from target_revisions);

with target_stories as (
  select id from public.stories where slug like 'rls-test-%'
), target_revisions as (
  select id from public.story_revisions where story_id in (select id from target_stories)
)
delete from public.story_publication_attempts
  where revision_id in (select id from target_revisions);

-- Clear the forward pointers before deleting revisions (they reference
-- story_revisions with on delete restrict too).
update public.stories
  set current_draft_revision_id = null, published_revision_id = null
  where slug like 'rls-test-%';

delete from public.story_revisions where story_id in (
  select id from public.stories where slug like 'rls-test-%'
);

delete from public.story_media where story_id in (
  select id from public.stories where slug like 'rls-test-%'
);

delete from public.stories where slug like 'rls-test-%';

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
