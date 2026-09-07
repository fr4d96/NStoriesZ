-- Private stories, part 2 of 2: a contributor can finish a story and keep
-- it to themselves, with no moderator involved.
--
-- THE RULE THIS IMPLEMENTS
--
--   Moderator review exists to protect what the PUBLIC sees. A story that
--   is never published publicly has nothing for a moderator to protect, so
--   it does not enter review at all.
--
-- The submit step therefore becomes a choice of two destinations rather
-- than one:
--
--   "Publish publicly"  -> submit_revision_with_consent() (unchanged):
--                          records publication consent, revision goes
--                          'draft' -> 'submitted', story goes
--                          'draft' -> 'pending_review', moderator reviews,
--                          approve_revision()/finalize_story_publication()
--                          set visibility='public' + lifecycle='published'.
--
--   "Keep private"      -> keep_revision_private() (new, below): NO consent
--                          record, revision STAYS 'draft', story goes
--                          'draft' -> 'private', visibility stays 'private'.
--
-- WHY THE REVISION STAYS 'draft'. Three things fall out of it for free, and
-- each one is a rule we would otherwise have had to re-enforce by hand:
--
--   1. get_moderation_queue() selects `where r.revision_status =
--      'submitted'`. A revision that never becomes 'submitted' can never
--      appear in the queue -- no new exclusion filter, nothing a future
--      queue change could forget.
--   2. Approval is what promotes images out of the private bucket into
--      public delivery (Engineering Rules 13-14). A private story never
--      reaches approve_revision(), so its images stay private by doing
--      nothing at all, rather than by a rule that could be missed.
--   3. story_revisions_protect_immutable_content() freezes a revision the
--      instant it leaves 'draft'. Immutability exists so a revision_id is a
--      trustworthy snapshot of what was consented to and published. A
--      private story has consented to nothing and published nothing, so
--      freezing it would buy no guarantee and would cost the contributor
--      the ability to keep working on their own private story. Staying
--      'draft' keeps editing working with no change to the editor, the
--      preview page, or _revision_is_editable()'s meaning.
--
-- WHY PRIVATE CONTENT CANNOT LEAK. A public read requires THREE independent
-- conditions, and a private story fails every one of them separately:
--   * s.visibility = 'public'          -- a private story is 'private'
--   * s.lifecycle_status = 'published' -- a private story is 'private'
--   * a joined story_publication_consents row with consent_status='granted'
--     -- keep_revision_private() writes no consent row at all
-- (see list_published_stories / get_published_story in
-- 20260903140100_custom_destination_reads_and_copy.sql). No public function
-- is modified by this migration, deliberately: the correct change to a
-- public query here is no change.
--
-- WHAT IS DELIBERATELY *NOT* BUILT HERE
--
--   * Making an ALREADY-PUBLISHED story private. That is a takedown, and it
--     already has its own governed flow with its own audit trail
--     (request_story_takedown / revoke_publication_consent, and
--     docs/content-governance.md). keep_revision_private() refuses a story
--     with a published_revision_id rather than quietly becoming a second,
--     unaudited way to unpublish something.
--   * A private *editorial import*. An editorial import exists because
--     staff prepared it for publication; letting it be locked away
--     privately would strand that work and there is no product reason to.
--     Refused explicitly, with a message that says so.
--
-- GOING PUBLIC LATER needs no new function. A private story's revision is
-- still an editable draft, so the contributor submits it through the
-- ordinary submit_revision_with_consent() path, which sets
-- lifecycle_status='pending_review' exactly as it does from 'draft' (its
-- `published_revision_id is null` branch). Only _revision_is_editable()
-- had to learn about the new status for that to work.

-- ---------------------------------------------------------------------
-- Column
-- ---------------------------------------------------------------------

alter table public.stories add column if not exists kept_private_at timestamptz;

comment on column public.stories.kept_private_at is
  'When the contributor last chose to keep this story private (keep_revision_private()). The counterpart to submitted_at/published_at for the private branch of the submit step. Never cleared -- a story that later goes public keeps the timestamp as history, the same way submitted_at survives publication.';

comment on column public.stories.lifecycle_status is
  'Where the story is in its life. ''private'' means the contributor finished it and chose NOT to publish it: no moderator review, no publication consent recorded, images never promoted out of the private bucket, and the revision stays an editable draft. ''published'' is the only status public reads accept, and only together with visibility = ''public'' and a granted consent row.';

-- ---------------------------------------------------------------------
-- _revision_is_editable(): 'private' is ordinary authoring too
-- ---------------------------------------------------------------------
--
-- The ONE place that defines "is this revision the contributor's to edit
-- right now". Adding 'private' here is what makes a private story keep
-- behaving like the working draft it still is -- the editor page, the
-- preview page, save_revision_draft(), every set_revision_* function and
-- every child-table immutability trigger all defer to this function, so
-- none of them needs its own copy of the rule.
--
-- It also, deliberately, re-opens submit_revision_with_consent() for a
-- private story: that is the "I changed my mind, publish it after all"
-- path, and it lands in the moderation queue like any other first
-- submission. There is no separate promote-to-public function precisely so
-- that going public is always the SAME code path, with the same consent
-- record and the same review.
--
-- Verbatim from 20260803090250_story_internal_helpers.sql apart from the
-- one added enum value.
create or replace function public._revision_is_editable(p_revision_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.story_revisions r
    join public.stories s on s.id = r.story_id
    where r.id = p_revision_id
      and s.current_draft_revision_id = p_revision_id
      and r.revision_status = 'draft'
      and s.lifecycle_status in ('draft', 'private', 'published')
  );
$$;

comment on function public._revision_is_editable(uuid) is
  'Internal: true only when the revision is the story''s active draft pointer, status = draft, and the story is in ordinary authoring (''draft''), private authoring (''private'') or replacement authoring (''published'') -- not while awaiting contributor review or any other lifecycle state. No API grants.';

revoke execute on function public._revision_is_editable(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- keep_revision_private(): the private half of the submit step
-- ---------------------------------------------------------------------
--
-- Structured to mirror submit_revision_with_consent() check-for-check, so
-- the two halves of the same UI step cannot drift into disagreeing about
-- who may act, on what, and when. Same lock order (revision, then story),
-- same optimistic-version check, same owner re-derivation, same
-- editability gate, same WHV03 empty-content rule.
--
-- The differences are all deliberate, and all subtractions:
--   * no terms-version check      -- terms govern PUBLICATION; nothing is
--                                    being published, so there is nothing
--                                    to hold the contributor to.
--   * no publication consent      -- and specifically NO row in
--                                    story_publication_consents. That table
--                                    is the record of permission to publish
--                                    (docs/content-governance.md); writing
--                                    one for a story nobody consented to
--                                    publish would corrupt the one place we
--                                    look to answer "were we allowed to
--                                    publish this".
--   * no image-rights / identifiable-people confirmation
--                                 -- those questions are about sharing
--                                    images PUBLICLY. The images stay in
--                                    the private bucket, visible only to
--                                    the person who uploaded them.
--   * no attribution snapshot     -- attribution is a public byline.
--
-- Requirements it does NOT impose, where submission does: a location and a
-- tag. Those exist so a PUBLIC story is findable in browse/search
-- (lib/story/steps.ts#missingStoryRequirements). Nobody will ever search
-- for a private story, so demanding them would be friction with no purpose.
-- A title and some actual content are still required -- that is what makes
-- the thing a story rather than an empty shell, and it is enforced here and
-- not only in the UI, for the same Engineering Rule 2 reason
-- 20260902090000 gave when it added WHV03 to submission.
--
-- IDEMPOTENT on purpose: calling it on a story that is already 'private'
-- succeeds and refreshes kept_private_at. The contributor edits a private
-- story and presses "Save as private" again; that is a save, not an error.
create or replace function public.keep_revision_private(
  p_revision_id uuid,
  p_expected_version integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revision public.story_revisions;
  v_story public.stories;
begin
  select * into v_revision from public.story_revisions where id = p_revision_id for update;
  if not found then
    raise exception 'No such revision: %', p_revision_id;
  end if;

  select * into v_story from public.stories where id = v_revision.story_id for update;
  if v_story.version <> p_expected_version then
    raise exception 'Stale version for story % (expected %, got %)', v_story.id, v_story.version, p_expected_version;
  end if;

  -- Ownership re-derived from the database, never from the caller
  -- (Engineering Rule 2). _is_story_owner() is the same helper every other
  -- owner-gated function uses, so "owner" cannot come to mean two things.
  if not public._is_story_owner(v_story.id) then
    raise exception 'Only the story owner can keep this story private';
  end if;

  if v_story.source_kind <> 'self_submitted' then
    raise exception using
      errcode = 'WHV04',
      message = 'An editor-prepared story cannot be kept private. Ask your editor to withdraw it instead.';
  end if;

  -- An already-public story is never made private through here; see this
  -- migration's header ("WHAT IS DELIBERATELY NOT BUILT"). Checked against
  -- published_revision_id rather than lifecycle_status because a published
  -- story with an edit in flight KEEPS lifecycle_status = 'published'
  -- (Engineering Rule 11), so the pointer is the honest test of "has the
  -- public ever seen this".
  if v_story.published_revision_id is not null then
    raise exception using
      errcode = 'WHV04',
      message = 'This story is already published. Use the take-down request to remove it from public view.';
  end if;

  if v_story.consent_revoked_at is not null then
    raise exception 'Consent has been revoked for story %; it can no longer be edited or saved', v_story.id;
  end if;

  -- Covers every remaining wrong state in one check, and by construction
  -- agrees with what the editor and preview page allow: not the active
  -- pointer, not a draft any more (already submitted / rejected /
  -- withdrawn / superseded), or a lifecycle that has taken the story out of
  -- the contributor's hands (awaiting_contributor_approval,
  -- pending_review, changes_requested, rejected, archived).
  if v_revision.revision_status <> 'draft' or not public._revision_is_editable(p_revision_id) then
    raise exception 'Revision % is not in a state that can be saved privately', p_revision_id;
  end if;

  if public._content_json_text_length(v_revision.content_json) = 0 then
    raise exception using
      errcode = 'WHV03',
      message = 'This story has no content yet — write something before you save it.';
  end if;

  update public.stories
    set lifecycle_status = 'private',
        visibility = 'private',
        kept_private_at = now(),
        version = version + 1
    where id = v_story.id;
end;
$$;

comment on function public.keep_revision_private(uuid, integer) is
  'The private half of the submit step: marks a self-submitted, never-published story as kept-private (lifecycle_status = ''private'', visibility = ''private''). Writes NO story_publication_consents row -- nothing is being published -- and leaves the revision an editable draft, which is what keeps it out of get_moderation_queue() and keeps its images in the private bucket. Raises WHV03 for an empty story and WHV04 for an editorial import or an already-published story. Idempotent on a story that is already private.';

revoke execute on function public.keep_revision_private(uuid, integer) from public, anon, authenticated;
grant execute on function public.keep_revision_private(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------
-- delete_draft_story(): a private story is still deletable
-- ---------------------------------------------------------------------
--
-- Deleting your own unpublished story is the one destructive action a
-- contributor already has, and it is gated on "never published, never
-- reviewed" -- which a private story satisfies completely. Refusing to
-- delete one would be an accidental regression: choosing "keep private"
-- would silently take away the ability to throw the story away, which is
-- the opposite of what "this is mine and nobody else's" should mean.
--
-- ONE line changes: the lifecycle_status guard now accepts 'private'
-- alongside 'draft'. Every other safeguard is untouched and still does the
-- real work -- ownership, optimistic version, published_revision_id is
-- null, the revision itself still 'draft', and exactly one revision ever
-- (so nothing with review history can be deleted this way). A private
-- story cannot have review history: reaching 'private' requires
-- _revision_is_editable(), which requires the story's only in-flight
-- revision to still be a draft.
--
-- The body below is byte-for-byte the live definition from
-- 20260903090000_delete_draft_story_expenses.sql -- extracted from that
-- file rather than retyped, so the child-table checklist it carries (the
-- thing three prior migrations exist because someone got wrong) cannot be
-- damaged in transcription here. Adding a per-revision child table still
-- means editing BOTH this function and create_next_draft_revision().
create or replace function public.delete_draft_story(
  p_story_id uuid, p_expected_version integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_story public.stories;
  v_revision_count integer;
  v_revision public.story_revisions;
begin
  select * into v_story from public.stories where id = p_story_id for update;
  if not found then
    raise exception 'No such story: %', p_story_id;
  end if;
  if not public._is_story_owner(p_story_id) then
    raise exception 'Only the story owner can delete this story';
  end if;
  if v_story.version <> p_expected_version then
    raise exception 'Stale version for story % (expected %, got %)', p_story_id, v_story.version, p_expected_version;
  end if;

  if v_story.lifecycle_status not in ('draft', 'private') or v_story.published_revision_id is not null then
    raise exception 'Only a never-published draft or private story can be deleted (story %)', p_story_id;
  end if;
  if v_story.current_draft_revision_id is null then
    raise exception 'Story % has no draft revision to delete', p_story_id;
  end if;

  select * into v_revision from public.story_revisions
    where id = v_story.current_draft_revision_id for update;
  if v_revision.revision_status <> 'draft' then
    raise exception 'Story % is not currently in a plain-draft state', p_story_id;
  end if;

  select count(*) into v_revision_count
  from public.story_revisions where story_id = p_story_id;
  if v_revision_count <> 1 then
    raise exception
      'Story % has prior reviewed revision history and cannot be deleted this way', p_story_id;
  end if;

  -- CHILD-TABLE CHECKLIST (site 2 of 2 -- the other is
  -- create_next_draft_revision, which COPIES the same list). Every table
  -- keyed off revision_id has `on delete restrict`, so each one must be
  -- cleared here before the story_revisions delete below or that delete
  -- raises and the whole deletion silently rolls back:
  --   story_revision_media
  --   story_media            (keyed off story_id, not revision_id)
  --   story_revision_locations
  --   story_revision_work_types
  --   story_revision_tags
  --   story_revision_expenses
  -- Adding a per-revision table means editing BOTH sites in the same
  -- change. Three migrations now exist only because that did not happen.
  delete from public.story_revision_media where revision_id = v_revision.id;
  delete from public.story_media where story_id = p_story_id;
  delete from public.story_revision_locations where revision_id = v_revision.id;
  delete from public.story_revision_work_types where revision_id = v_revision.id;
  delete from public.story_revision_tags where revision_id = v_revision.id;
  delete from public.story_revision_expenses where revision_id = v_revision.id;

  update public.stories set current_draft_revision_id = null where id = p_story_id;
  delete from public.story_revisions where id = v_revision.id;
  delete from public.stories where id = p_story_id;
end;
$$;

comment on function public.delete_draft_story(uuid, integer) is
  'Hard-deletes a never-published draft OR private story and every per-revision child row it owns. The function body carries the child-table checklist; it is one of TWO sites that enumerate those tables (create_next_draft_revision copies the same list), and both must be updated together when a new one is added -- every child FK is `on delete restrict`, so a missed table makes this fail and roll back silently rather than loudly.';

revoke execute on function public.delete_draft_story(uuid, integer) from public, anon, authenticated;
grant execute on function public.delete_draft_story(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------
-- get_content_readiness_queue(): private stories are not staff's work
-- ---------------------------------------------------------------------
--
-- This is the editorial "is the founding catalogue ready to launch"
-- checklist. It lists EVERY story at any lifecycle_status, self-submitted
-- drafts included, and shows staff each one's title and contributor.
--
-- A private story must not be in it. Not because the queue leaks anything
-- dangerous -- it returns a title, a contributor name and booleans, no
-- content and no storage paths -- but because "private" is a contributor
-- telling us this is not for anyone else, and a staff work queue is
-- precisely somewhere it has no business being. There is also nothing
-- actionable there: readiness measures how close a story is to PUBLICATION,
-- and a private story is not on its way to publication at all, so every row
-- would be permanent, un-closeable noise in a checklist whose whole job is
-- to reach zero.
--
-- p_lifecycle_status's accepted-value list is deliberately NOT extended
-- with 'private'. Passing it still raises "Unknown lifecycle_status", which
-- is the honest answer: private is not a filterable state of this queue,
-- and silently returning an empty page would read as "there are none right
-- now" rather than "this queue does not cover those".
--
-- Excluded here rather than in the app so it holds for every caller of the
-- RPC, present and future -- app/(readiness)/readiness/page.tsx is the only
-- one today.
--
-- get_operational_metrics() in the same original migration needs NO change,
-- and this was checked rather than assumed: its four status counts name
-- 'draft'(+editorial_import), 'awaiting_contributor_approval',
-- 'pending_review' and 'published' explicitly, and its missing_consent
-- count is scoped to `lifecycle_status in ('draft',
-- 'awaiting_contributor_approval', 'changes_requested')` -- so 'private'
-- falls outside all five without a line being touched. Had it been written
-- as "everything except published", a private story would have started
-- showing up as a consent problem the day this shipped.
--
-- The body below is extracted verbatim from
-- 20260806090000_content_readiness_and_metrics.sql (all 24 OUT columns and
-- every checklist expression), with `create function` re-issued as
-- `create or replace function` and ONE predicate added to the `relevant`
-- CTE.
create or replace function public.get_content_readiness_queue(
  p_source_kind text default null,
  p_lifecycle_status text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  story_id uuid,
  slug text,
  source_kind public.story_source_kind,
  lifecycle_status public.story_lifecycle_status,
  title text,
  contributor_id uuid,
  contributor_display_name text,
  contributor_linked boolean,
  attribution_type public.attribution_type,
  attribution_value text,
  excerpt_present boolean,
  body_present boolean,
  trip_date_or_year_present boolean,
  region_selected boolean,
  work_types_selected boolean,
  tags_selected boolean,
  images_uploaded boolean,
  cover_selected boolean,
  alt_text_complete boolean,
  image_rights_confirmed boolean,
  identifiable_people_resolved boolean,
  publication_consent_complete boolean,
  editorial_review_complete boolean,
  last_moderation_reason text,
  last_verified_at timestamptz,
  last_verified_desktop boolean,
  last_verified_mobile boolean,
  updated_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_offset integer;
begin
  if not (
    public.has_role(auth.uid(), 'editor')
    or public.has_role(auth.uid(), 'moderator')
    or public.has_role(auth.uid(), 'admin')
  ) then
    raise exception 'Only staff can read the content readiness queue';
  end if;
  if p_source_kind is not null and p_source_kind not in ('self_submitted', 'editorial_import') then
    raise exception 'Unknown source_kind: %', p_source_kind;
  end if;
  if p_lifecycle_status is not null and p_lifecycle_status not in (
    'draft', 'awaiting_contributor_approval', 'pending_review',
    'changes_requested', 'published', 'rejected', 'archived'
  ) then
    raise exception 'Unknown lifecycle_status: %', p_lifecycle_status;
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 20), 50));
  v_offset := greatest(0, coalesce(p_offset, 0));

  return query
    with relevant as (
      select
        s.*,
        coalesce(s.current_draft_revision_id, s.published_revision_id) as v_revision_id
      from public.stories s
      where (p_source_kind is null or s.source_kind::text = p_source_kind)
        and (p_lifecycle_status is null or s.lifecycle_status::text = p_lifecycle_status)
        -- NEW (20260907100100): a contributor's private story is not staff work.
        and s.lifecycle_status <> 'private'
    )
    select
      s.id,
      s.slug,
      s.source_kind,
      s.lifecycle_status,
      r.title,
      c.id,
      c.display_name,
      (c.linked_user_id is not null),
      c.attribution_type,
      con.attribution_value,
      (r.excerpt is not null and char_length(trim(r.excerpt)) > 0),
      (jsonb_array_length(r.content_json) > 0),
      (r.trip_year is not null or r.trip_start_date is not null),
      exists (select 1 from public.story_revision_locations l where l.revision_id = r.id),
      exists (select 1 from public.story_revision_work_types w where w.revision_id = r.id),
      exists (select 1 from public.story_revision_tags t where t.revision_id = r.id),
      exists (select 1 from public.story_revision_media m where m.revision_id = r.id),
      exists (select 1 from public.story_revision_media m where m.revision_id = r.id and m.is_cover),
      not exists (
        select 1 from public.story_revision_media m
        where m.revision_id = r.id and not m.decorative
          and (m.alt_text is null or char_length(trim(m.alt_text)) = 0)
      ),
      case
        when not exists (select 1 from public.story_revision_media m where m.revision_id = r.id) then true
        else con.image_rights_confirmed_at is not null
      end,
      case
        when not exists (select 1 from public.story_revision_media m where m.revision_id = r.id) then true
        else con.identifiable_people_state in ('confirmed', 'not_applicable')
      end,
      (con.id is not null and s.consent_revoked_at is null),
      (s.source_kind = 'self_submitted'
        or s.lifecycle_status in ('awaiting_contributor_approval', 'pending_review', 'published')),
      lastmod.user_facing_reason,
      lastver.created_at,
      lastver.desktop_checked,
      lastver.mobile_checked,
      s.updated_at,
      count(*) over ()
    from relevant s
    left join public.story_revisions r on r.id = s.v_revision_id
    left join public.contributors c on c.id = s.contributor_id
    left join public.story_publication_consents con on con.revision_id = s.v_revision_id
    left join lateral (
      select a.user_facing_reason
      from public.moderation_actions a
      where a.story_id = s.id
      order by a.created_at desc
      limit 1
    ) lastmod on true
    left join lateral (
      select v.created_at, v.desktop_checked, v.mobile_checked
      from public.story_launch_verifications v
      where v.story_id = s.id
      order by v.created_at desc
      limit 1
    ) lastver on true
    order by s.updated_at desc, s.id asc
    limit v_limit offset v_offset;
end;
$$;

comment on function public.get_content_readiness_queue(text, text, integer, integer) is
  'Editor/moderator/admin only. Per-story founding-catalogue readiness checklist, computed from existing tables -- see 20260806090000''s header comment for the two disclosed simplifications (attribution/consent/contributor-approval collapse to one signal; alt_text_complete is currently structurally guaranteed). Excludes stories the contributor kept private (20260907100100): they are not on their way to publication, so they would be permanent noise in a checklist meant to reach zero. Operational checklist only, not legal advice, never a publication gate. p_limit clamped to [1,50].';

revoke execute on function public.get_content_readiness_queue(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.get_content_readiness_queue(text, text, integer, integer) to authenticated;
