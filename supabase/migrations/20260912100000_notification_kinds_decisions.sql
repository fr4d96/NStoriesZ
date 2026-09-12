-- Two more notification kinds, for the contributor: their story was
-- rejected, or sent back with changes requested. Split from the trigger
-- migration that follows (20260912100100) because a new enum value cannot
-- be USED in the transaction that adds it, and `db push` runs each file
-- as one transaction.
--
-- `reason` carries the moderator's user-facing reason. moderation_actions
-- REQUIRES one for both decisions (moderation_actions_reason_required_on_decline,
-- 20260803090600) and calls the column user_facing_reason -- yet, checked
-- against every contributor-callable RPC, nothing has ever returned it to
-- the contributor. The inbox is the first place it reaches them.

alter type public.notification_kind add value 'story_rejected';
alter type public.notification_kind add value 'story_changes_requested';

alter table public.notifications add column reason text;

comment on column public.notifications.reason is
  'The moderator''s user-facing reason, snapshot from moderation_actions for story_rejected / story_changes_requested. Null for the other kinds.';
