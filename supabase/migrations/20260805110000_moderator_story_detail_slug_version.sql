-- Prompt 6 Stage 2: get_story_for_moderator() is missing two fields the
-- real review-page/Server-Action orchestration structurally needs and that
-- no other moderator-accessible function exposes:
--
--   - slug: needed to call lib/story/public-cache.ts's
--     invalidateStoryPublicCache(slug) after a successful approve/archive
--     from the review page. get_moderation_queue() returns slug, but only
--     for queue rows -- a moderator arriving at a review page directly (or
--     re-fetching after an action) has no other authorized way to learn a
--     story's slug, since `stories` carries no RLS policies at all (every
--     access goes through a SECURITY DEFINER function) and
--     get_story_for_editor() is editor-assigned/admin scoped, not moderator.
--   - story_version: archive_story()/reassign_editorial_story() both
--     require the caller's last-known expectedVersion for their optimistic-
--     concurrency check (Engineering Rule: never omit/default this
--     silently). No moderator-accessible function returns `stories.version`
--     today -- get_story_for_moderator() is the natural place, since the
--     review page already calls it as its primary data source.
--
-- This is a genuine gap found while wiring Stage 2's real approve/archive
-- Server Actions, not scope creep: DROP+CREATE because two new output
-- columns change the return shape (CREATE OR REPLACE cannot alter a
-- function's returns table columns). Diffed against the CURRENT live body
-- (20260805100900_moderator_story_detail_functions.sql -- confirmed
-- unchanged by any later migration by grepping every migration after it
-- for "get_story_for_moderator" before writing this).
--
-- NOT PUSHED as part of this stage -- see docs/implementation-status.md
-- "Prompt 6 detail -- Stage 2" for the explicit not-yet-applied flag, same
-- convention Stage 1 used for its own unpushed migrations before approval.

drop function if exists public.get_story_for_moderator(uuid);

create function public.get_story_for_moderator(p_revision_id uuid)
returns table (
  story_id uuid,
  slug text,
  story_version integer,
  revision_id uuid,
  revision_number integer,
  revision_status public.story_revision_status,
  title text,
  excerpt text,
  content_json jsonb,
  trip_start_date date,
  trip_end_date date,
  trip_year smallint,
  travel_style text,
  total_expense_nzd_cents integer,
  consent_valid boolean,
  media_processed boolean,
  attribution_type public.attribution_type,
  attribution_value text,
  confirmation_method text,
  image_rights_confirmed_at timestamptz,
  identifiable_people_state public.identifiable_people_state,
  media jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_story_id uuid;
  v_slug text;
  v_version integer;
begin
  if not (public.has_role(auth.uid(), 'moderator') or public.has_role(auth.uid(), 'admin')) then
    raise exception 'Only a moderator or admin can read this view';
  end if;

  select r.story_id into v_story_id from public.story_revisions r where r.id = p_revision_id;
  if v_story_id is null then raise exception 'No such revision: %', p_revision_id; end if;

  select s.slug, s.version into v_slug, v_version from public.stories s where s.id = v_story_id;

  return query
    select
      v_story_id,
      v_slug,
      v_version,
      r.id,
      r.revision_number,
      r.revision_status,
      r.title,
      r.excerpt,
      r.content_json,
      r.trip_start_date,
      r.trip_end_date,
      r.trip_year,
      r.travel_style,
      r.total_expense_nzd_cents,
      (public._latest_valid_consent_for_revision(v_story_id, r.id) is not null),
      not exists (
        select 1 from public.story_revision_media rm
        join public.story_media m on m.id = rm.media_id
        where rm.revision_id = r.id
          and (m.approved_public_storage_path is null or m.metadata_removed_at is null)
      ),
      c.attribution_type,
      c.attribution_value,
      c.confirmation_method,
      c.image_rights_confirmed_at,
      c.identifiable_people_state,
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'mediaId', rm.media_id,
              'sortOrder', rm.sort_order,
              'isCover', rm.is_cover,
              'altText', rm.alt_text,
              'caption', rm.caption,
              'decorative', rm.decorative,
              'processingState', m.processing_state
            )
            order by rm.sort_order
          )
          from public.story_revision_media rm
          join public.story_media m on m.id = rm.media_id
          where rm.revision_id = r.id
        ),
        '[]'::jsonb
      )
    from public.story_revisions r
    left join public.story_publication_consents c on c.revision_id = r.id
    where r.id = p_revision_id;
end;
$$;

comment on function public.get_story_for_moderator(uuid) is
  'Moderator/admin only. Same shape as Stage 1''s version, plus slug and story_version -- both needed by Stage 2''s real approve/archive Server Actions (cache invalidation and expectedVersion respectively), which no other moderator-accessible function exposes.';

revoke execute on function public.get_story_for_moderator(uuid) from public, anon, authenticated;
grant execute on function public.get_story_for_moderator(uuid) to authenticated;
