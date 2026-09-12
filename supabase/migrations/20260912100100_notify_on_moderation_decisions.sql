-- Contributor notifications for reject / changes requested, created from
-- the moderation_actions audit row rather than the revision status change.
--
-- WHY A SECOND TRIGGER, ON A DIFFERENT TABLE
--
-- The first instinct is two more branches in _notify_on_revision_status_change()
-- (20260911100000). But moderate_revision() flips story_revisions.revision_status
-- FIRST and inserts the moderation_actions row -- the one carrying
-- user_facing_reason -- AFTER. A row-level AFTER UPDATE trigger on the
-- revision runs between those two statements and cannot see a reason that
-- does not exist yet. A deferred constraint trigger could wait for commit,
-- at the cost of making the simplest trigger in the schema the least
-- obvious one.
--
-- The audit row IS the decision: it exists only for a decision, it is
-- immutable, and the reason is mandatory on it. So the decision
-- notifications hang off it. The split is deliberate and readable --
-- status transitions (submitted / approved) notify from story_revisions;
-- moderator decisions with a reason notify from moderation_actions. The
-- story_submitted auto-read on leaving review stays where it was, on the
-- status change, because that is the fact it is about.
--
-- The recipient rule is now one helper shared by both triggers, so the
-- self_submitted/editorial_import partition cannot drift between them.

create or replace function public._notification_recipient_for_story(p_story_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when s.source_kind = 'self_submitted' then s.owner_user_id
    else c.linked_user_id
  end
  from public.stories s
  left join public.contributors c on c.id = s.contributor_id
  where s.id = p_story_id;
$$;

comment on function public._notification_recipient_for_story(uuid) is
  'Which auth.users row is "the contributor" for a story, for notification purposes: self_submitted -> owner_user_id, editorial_import -> contributors.linked_user_id (null when never signed up). Same partition as list_my_stories(). Internal.';

revoke all on function public._notification_recipient_for_story(uuid) from public, anon, authenticated;

-- Unchanged behaviour; the inline recipient derivation becomes the helper.
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
    v_recipient := public._notification_recipient_for_story(v_story.id);
    if v_recipient is not null then
      insert into public.notifications (
        recipient_user_id, kind, story_id, revision_id, story_title, story_slug
      )
      values (v_recipient, 'story_published', v_story.id, new.id, new.title, v_story.slug);
    end if;
  end if;

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

create or replace function public._notify_on_moderation_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_story public.stories;
  v_revision public.story_revisions;
  v_recipient uuid;
begin
  if new.new_status not in ('rejected', 'changes_requested') then
    return new;
  end if;

  v_recipient := public._notification_recipient_for_story(new.story_id);
  if v_recipient is null then
    return new;
  end if;

  select * into v_story from public.stories where id = new.story_id;
  select * into v_revision from public.story_revisions where id = new.revision_id;

  insert into public.notifications (
    recipient_user_id, kind, story_id, revision_id, story_title, story_slug, reason
  )
  values (
    v_recipient,
    case new.new_status
      when 'rejected' then 'story_rejected'::public.notification_kind
      else 'story_changes_requested'::public.notification_kind
    end,
    v_story.id, v_revision.id, v_revision.title, v_story.slug, new.user_facing_reason
  );

  return new;
end;
$$;

comment on function public._notify_on_moderation_decision() is
  'AFTER INSERT trigger on moderation_actions: for a rejected / changes_requested decision, notifies the story''s contributor with the moderator''s user-facing reason. Internal -- never callable over the API.';

revoke all on function public._notify_on_moderation_decision() from public, anon, authenticated;

create trigger moderation_actions_notify_decision
  after insert on public.moderation_actions
  for each row
  execute function public._notify_on_moderation_decision();

-- list_my_notifications() gains `reason`. RETURNS TABLE changed, so DROP +
-- CREATE, and a DROP takes its grants with it -- re-applied below (the trap
-- 20260909130000 and 20260910090000 both document).
drop function public.list_my_notifications(integer);

create function public.list_my_notifications(p_limit integer default 20)
returns table (
  id uuid,
  kind public.notification_kind,
  story_id uuid,
  revision_id uuid,
  story_title text,
  story_slug text,
  reason text,
  read_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select n.id, n.kind, n.story_id, n.revision_id, n.story_title, n.story_slug,
         n.reason, n.read_at, n.created_at
  from public.notifications n
  where n.recipient_user_id = auth.uid()
  order by n.created_at desc, n.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

comment on function public.list_my_notifications(integer) is
  'The caller''s own inbox, newest first. p_limit clamped to [1, 50]. Signed-out callers get no rows (auth.uid() is null). `reason` is set only for story_rejected / story_changes_requested.';

revoke all on function public.list_my_notifications(integer) from public, anon;
grant execute on function public.list_my_notifications(integer) to authenticated;
