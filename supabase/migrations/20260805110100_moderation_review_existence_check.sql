-- Prompt 6 Stage 2: a lightweight, existence-only per-row authorization
-- check for proxy.ts's /moderation/stories/[revisionId] route, mirroring
-- canReadStoryDraft()/canPreviewStory()'s established pattern exactly
-- (call a narrow RPC, check data.length > 0 -- error and "not found" look
-- identical to the caller, same as every other staff per-row check in this
-- app).
--
-- Deliberately NOT a reuse of get_story_for_moderator(): that function
-- builds the full review payload (content_json, consent snapshot, a
-- jsonb_agg of every attached media item) on every call -- reusing it here
-- would mean middleware fetches the entire review payload on every request
-- to /moderation/stories/:id just to decide a 404, which is exactly the
-- cost the brief calls out to avoid. This function returns nothing but the
-- revision's own id, gated behind the same moderator/admin role check.
--
-- Scope of "exists": a moderator/admin may view ANY revision that has ever
-- been through moderation review, not just currently-submitted ones -- the
-- review page must keep working after a decision is made (moderation
-- history, recently_reviewed queue), so this intentionally does not filter
-- on revision_status. It only confirms (a) the revision row exists and
-- (b) the caller holds a role allowed to view moderator review pages at
-- all; the review page's own data-fetching functions (getStoryForModerator
-- et al.) remain the authoritative content-level checks.
--
-- NOT PUSHED as part of this stage -- see docs/implementation-status.md
-- "Prompt 6 detail -- Stage 2" for the explicit not-yet-applied flag.

create function public.can_view_moderation_review(p_revision_id uuid)
returns table (revision_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.has_role(auth.uid(), 'moderator') or public.has_role(auth.uid(), 'admin')) then
    raise exception 'Only a moderator or admin can view a moderation review page';
  end if;

  return query
    select r.id from public.story_revisions r where r.id = p_revision_id;
end;
$$;

comment on function public.can_view_moderation_review(uuid) is
  'Moderator/admin only, existence-only. Returns one row (the revision id) if the revision exists and the caller holds a role allowed to view review pages at all; used by proxy.ts as a cheap per-row authorization check for /moderation/stories/[revisionId], instead of fetching the full get_story_for_moderator() payload just to decide a 404.';

revoke execute on function public.can_view_moderation_review(uuid) from public, anon, authenticated;
grant execute on function public.can_view_moderation_review(uuid) to authenticated;
