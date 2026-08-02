-- Bug fix, found via the RLS integration suite (tests/integration/
-- story-rls.integration.test.ts): Supabase's default project setup grants
-- broad table privileges to anon/authenticated on every table created in
-- the public schema, independent of RLS. RLS-enabled-with-zero-policies
-- still denies all rows (SELECT returns none, UPDATE/DELETE match none), so
-- nothing was actually readable or writable — but the documented "no direct
-- grants" model was not literally true at the privilege-grant level, only
-- true in effect via RLS. This migration makes it literally true, matching
-- docs/architecture.md exactly, and is stricter defense-in-depth: even a
-- future migration that accidentally adds a permissive RLS policy still
-- can't leak anything until someone also explicitly re-grants the table.

revoke all on
  public.stories,
  public.story_revisions,
  public.story_revision_locations,
  public.story_revision_work_types,
  public.story_revision_tags,
  public.story_revision_editor_notes,
  public.story_media,
  public.story_revision_media,
  public.story_publication_consents,
  public.story_publication_consent_notes,
  public.moderation_actions,
  public.moderation_action_notes,
  public.story_reports,
  public.editorial_actions
from public, anon, authenticated;
