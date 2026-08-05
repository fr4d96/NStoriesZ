-- Prompt 6 Stage 1: narrow moderator row-level access to `contributors`.
--
-- docs/architecture.md "Known trade-off: moderator visibility into
-- contributors is row-level, not column-level" flagged this as a risk to
-- resolve once moderation UI existed. This is that point: the new
-- get_story_for_moderator() (previous migration) sources attribution
-- entirely from the revision's own story_publication_consents snapshot,
-- never a live contributors join, and no other moderator-callable function
-- added in this stage reads contributors directly either.
--
-- Grepped the whole repo (app/, lib/, components/) for
-- `.from("contributors")`/`.from('contributors')` before making this
-- change: the only call sites are (1) a contributor's own self-service
-- identity actions (app/(contributor)/actions.ts, app/(contributor)/account/page.tsx
-- -- already covered by the separate "owner reads own contributor record"
-- policy, untouched here) and (2) the editorial contributor list/creation
-- flow (lib/story/editorial-queries.ts -- editor/admin only, already
-- covered by a policy this migration keeps). No moderation code path
-- anywhere touches the contributors table directly. Removing moderator
-- access entirely (rather than trying to build a column-restricted view)
-- is therefore safe now, and simpler than the view/dedicated-Postgres-role
-- options the architecture doc listed as alternatives -- there is no
-- moderator UI need for it at all once the new consent-snapshot-backed
-- functions exist.
--
-- The public/self-service/staff-insert/update/delete policies from
-- 20260802085016_contributors.sql are otherwise unchanged -- only the
-- "staff read all" SELECT policy is replaced, narrowed to editor/admin.

drop policy if exists "contributors: staff read all contributor records" on public.contributors;

create policy "contributors: editor or admin read all contributor records"
  on public.contributors
  for select
  to authenticated
  using (
    public.has_role(auth.uid(), 'editor')
    or public.has_role(auth.uid(), 'admin')
  );

comment on policy "contributors: editor or admin read all contributor records" on public.contributors is
  'Narrowed from editor/moderator/admin (Prompt 2) to editor/admin only (Prompt 6 Stage 1) -- a moderator has no remaining need for direct contributors access now that get_story_for_moderator() sources attribution from the story_publication_consents snapshot, never a live join. See this migration''s header comment for the grep confirming no moderator-reachable code path relied on the removed access.';
