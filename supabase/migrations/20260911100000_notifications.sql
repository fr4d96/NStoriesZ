-- In-app notifications, two kinds:
--
--   story_submitted  -> every moderator and admin, when a revision enters
--                       review ("a story needs to be reviewed").
--   story_published  -> the contributor, when a moderator approves their
--                       story and it goes live.
--
-- WHY A TRIGGER, NOT TWO EDITS
--
-- Exactly two live functions write those states -- checked against the
-- deployed catalogue, not the migration files: submit_revision_with_consent()
-- is the only writer of revision_status = 'submitted' and
-- finalize_story_publication() the only writer of 'approved'. Editing both
-- would work today. A trigger on the column works for every writer,
-- including the ones nobody has written yet: the moment a future RPC moves a
-- revision to 'submitted' by any route (an offline-consent path, a
-- contributor approving an editorial import, a bulk tool), the moderators
-- hear about it without that RPC's author having to remember this file
-- exists. Engineering Rule 2 in trigger form -- the server decides who is
-- told, from state it already holds; the client is never asked.
--
-- WHO RECEIVES story_published
--
-- The same rule list_my_stories() (20260812100000) uses to decide whose
-- story this is: self_submitted -> stories.owner_user_id; editorial_import
-- -> contributors.linked_user_id. An imported story whose contributor has
-- never signed up has nobody to notify, and gets no row rather than a row
-- with a null recipient. NOT coalesce(owner_user_id, linked_user_id): the
-- source-kind partition (20260804092200) exists precisely so an
-- editorial-import story's owner_user_id -- if ever set -- does not become
-- an authority over it.
--
-- WHO RECEIVES story_submitted
--
-- Everyone in user_roles with role moderator or admin, one row each -- a
-- per-recipient row is what makes "read" a per-person fact, and the staff
-- pool is a handful of accounts, so fanning out at write time costs nothing.
-- The submitting actor is excluded (an admin submitting their own story does
-- not need to be told they did). When the revision later LEAVES 'submitted'
-- -- approved, rejected, changes requested -- every still-unread
-- story_submitted row for it is marked read: "needs to be reviewed" stops
-- being true the moment one moderator reviews it, and leaving the other two
-- moderators with an unread badge pointing at a finished review would make
-- the badge a thing you learn to ignore.
--
-- ACCESS MODEL
--
-- Same as every story-domain table (docs/architecture.md "no direct table
-- access, for anyone"): RLS enabled with zero policies, every table grant
-- revoked, reads and the one permitted write (read_at) through SECURITY
-- DEFINER functions keyed on auth.uid(). The trigger function is SECURITY
-- DEFINER too -- it runs inside RPCs invoked by ordinary callers who hold
-- no INSERT privilege on this table, which is the point.
--
-- ONE DELIBERATE DEVIATION from the deletion policy: story_id and
-- revision_id are `on delete cascade`, not `restrict`. Every other child of
-- a story is either content or an audit record, and restrict is what stops
-- audit history from vanishing. A notification is neither -- it is an inbox
-- item derived from the audit record (moderation_actions) that still exists.
-- Restrict here would make delete_draft_story() (20260907100100) a fourth
-- enumeration site for a table that has nothing to preserve, and a
-- forgotten entry there would turn "delete this draft" into a foreign-key
-- error for the contributor. (In practice a deletable story never had a
-- submitted revision, so no row exists to cascade -- the cascade is the
-- safety net, not the expected path.) scripts/rls-test-cleanup.sql still
-- enumerates this table explicitly, because it runs with foreign keys off.

create type public.notification_kind as enum ('story_submitted', 'story_published');

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references auth.users (id) on delete cascade,
  kind public.notification_kind not null,
  story_id uuid not null references public.stories (id) on delete cascade,
  revision_id uuid not null references public.story_revisions (id) on delete cascade,
  -- Snapshots, so the inbox can be listed without joining story_revisions
  -- (which the recipient may not otherwise be allowed to read -- a
  -- moderator's access to a revision ends when it leaves review, but the
  -- line in their inbox should still say what it was about). The slug never
  -- changes after creation (_generate_story_slug runs once); the title is
  -- the title at the moment of the event, which is the one the recipient
  -- will recognise.
  story_title text not null,
  story_slug text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.notifications is
  'Per-recipient in-app inbox rows, created only by the story_revisions status trigger. No direct table access; read via list_my_notifications()/count_my_unread_notifications(), written via mark_my_notifications_read(). story/revision FKs cascade on purpose -- see the migration header.';

create trigger notifications_set_updated_at
  before update on public.notifications
  for each row
  execute function public.set_updated_at();

-- The inbox query: newest first, per recipient. read_at is in the index so
-- the unread count is an index-only scan.
create index notifications_recipient_created_idx
  on public.notifications (recipient_user_id, created_at desc);
create index notifications_recipient_unread_idx
  on public.notifications (recipient_user_id)
  where read_at is null;
-- The auto-read on leaving review looks rows up by revision.
create index notifications_revision_id_idx
  on public.notifications (revision_id);

alter table public.notifications enable row level security;
revoke all on public.notifications from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The trigger
-- ---------------------------------------------------------------------------

create or replace function public._notify_on_revision_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_story public.stories;
  v_recipient uuid;
begin
  if new.revision_status is not distinct from old.revision_status then
    return new;
  end if;

  select * into v_story from public.stories where id = new.story_id;

  if new.revision_status = 'submitted' then
    insert into public.notifications (
      recipient_user_id, kind, story_id, revision_id, story_title, story_slug
    )
    select ur.user_id, 'story_submitted', v_story.id, new.id, new.title, v_story.slug
    from public.user_roles ur
    where ur.role in ('moderator', 'admin')
      and ur.user_id is distinct from auth.uid();

  elsif new.revision_status = 'approved' then
    if v_story.source_kind = 'self_submitted' then
      v_recipient := v_story.owner_user_id;
    else
      select c.linked_user_id into v_recipient
      from public.contributors c where c.id = v_story.contributor_id;
    end if;

    if v_recipient is not null then
      insert into public.notifications (
        recipient_user_id, kind, story_id, revision_id, story_title, story_slug
      )
      values (v_recipient, 'story_published', v_story.id, new.id, new.title, v_story.slug);
    end if;
  end if;

  -- Leaving review, by any decision: the "needs a review" rows are done.
  if old.revision_status = 'submitted' then
    update public.notifications
      set read_at = now()
      where revision_id = new.id
        and kind = 'story_submitted'
        and read_at is null;
  end if;

  return new;
end;
$$;

comment on function public._notify_on_revision_status_change() is
  'AFTER UPDATE OF revision_status trigger on story_revisions: fans story_submitted out to every moderator/admin (minus the actor), sends story_published to the story''s contributor, and marks a revision''s story_submitted rows read once it leaves review. Internal -- never callable over the API.';

revoke all on function public._notify_on_revision_status_change() from public, anon, authenticated;

create trigger story_revisions_notify_status_change
  after update of revision_status on public.story_revisions
  for each row
  execute function public._notify_on_revision_status_change();

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------

create or replace function public.list_my_notifications(p_limit integer default 20)
returns table (
  id uuid,
  kind public.notification_kind,
  story_id uuid,
  revision_id uuid,
  story_title text,
  story_slug text,
  read_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select n.id, n.kind, n.story_id, n.revision_id, n.story_title, n.story_slug,
         n.read_at, n.created_at
  from public.notifications n
  where n.recipient_user_id = auth.uid()
  order by n.created_at desc, n.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

comment on function public.list_my_notifications(integer) is
  'The caller''s own inbox, newest first. p_limit clamped to [1, 50]. Signed-out callers get no rows (auth.uid() is null).';

revoke all on function public.list_my_notifications(integer) from public, anon;
grant execute on function public.list_my_notifications(integer) to authenticated;

create or replace function public.count_my_unread_notifications()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.notifications n
  where n.recipient_user_id = auth.uid()
    and n.read_at is null;
$$;

comment on function public.count_my_unread_notifications() is
  'Unread count for the caller''s own inbox -- the header badge. Signed-out callers get 0.';

revoke all on function public.count_my_unread_notifications() from public, anon;
grant execute on function public.count_my_unread_notifications() to authenticated;

-- ---------------------------------------------------------------------------
-- The one write
-- ---------------------------------------------------------------------------

-- p_ids null = everything. Scoped to auth.uid() inside the function, so a
-- caller passing someone else's ids marks nothing and learns nothing --
-- the returned count only ever reflects their own rows.
create or replace function public.mark_my_notifications_read(p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  update public.notifications
    set read_at = now()
    where recipient_user_id = auth.uid()
      and read_at is null
      and (p_ids is null or id = any (p_ids));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.mark_my_notifications_read(uuid[]) is
  'Marks the caller''s own unread notifications read -- the given ids, or all of them when p_ids is null. Returns how many rows changed. Never touches another user''s rows regardless of the ids passed.';

revoke all on function public.mark_my_notifications_read(uuid[]) from public, anon;
grant execute on function public.mark_my_notifications_read(uuid[]) to authenticated;
