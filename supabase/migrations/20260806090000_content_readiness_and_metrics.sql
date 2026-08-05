-- Prompt 7: founding-catalogue content-readiness dashboard + operational
-- metrics + a manual post-publication verification record.
--
-- Every readiness signal below is computed straight from existing tables --
-- no new "is this actually complete" judgment state was invented. Two
-- deliberate simplifications, disclosed here rather than left implicit
-- (same "document the collapse" pattern this codebase already uses, e.g.
-- Prompt 6 Stage 1's submission_kind precedence note):
--
-- 1. The brief lists "Attribution choice confirmed", "Publication consent
--    complete", and "Contributor approval complete" as three separate
--    checklist items. In this schema they resolve to the SAME underlying
--    fact: submit_revision_with_consent() is the one atomic function that
--    records attribution + consent + (for editorial imports) the
--    contributor's own approval, all in one append-only
--    story_publication_consents row bound to one revision_id. There is no
--    separate "attribution chosen but consent not yet given" state to
--    distinguish -- so all three surface as one boolean,
--    publication_consent_complete, alongside the raw attribution_type/value
--    for a human to read directly.
-- 2. "Images uploaded" / "alt text complete" reads real per-row state, but
--    alt_text_complete will always be true for any row that could exist at
--    all -- story_revision_media_alt_text_required (20260803090400) already
--    makes "alt_text is null and not decorative" unrepresentable at the
--    database level. Kept anyway: it's cheap, it's what the brief literally
--    asks for, and it's a real (if currently redundant) guard against future
--    constraint drift.
--
-- "Public verification status after publication" has no existing signal to
-- derive from -- it is inherently a human, post-publish, cross-device check
-- ("does this actually render correctly on the live site, desktop and
-- mobile"). story_launch_verifications below is the new, minimal, append-only
-- record of that check having happened -- not an automated correctness
-- check, and not a gate on anything (recording one, or not, never changes a
-- story's lifecycle_status).

create table public.story_launch_verifications (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.stories (id) on delete restrict,
  revision_id uuid not null references public.story_revisions (id) on delete restrict,
  verified_by uuid references auth.users (id) on delete set null,
  desktop_checked boolean not null default false,
  mobile_checked boolean not null default false,
  note text,
  created_at timestamptz not null default now(),
  constraint story_launch_verifications_note_length check (note is null or char_length(note) <= 2000),
  constraint story_launch_verifications_at_least_one_check check (desktop_checked or mobile_checked)
);

comment on table public.story_launch_verifications is
  'Append-only record that a staff member manually confirmed a published story renders correctly (desktop and/or mobile). Purely observational -- recording one never changes stories.lifecycle_status or any publication state. No direct API grants; only record_story_launch_verification() inserts.';

create index story_launch_verifications_story_id_idx on public.story_launch_verifications (story_id);

alter table public.story_launch_verifications enable row level security;
-- No policies -- every access is a SECURITY DEFINER function, same
-- convention as every other story-domain table.

create function public.record_story_launch_verification(
  p_story_id uuid,
  p_desktop_checked boolean,
  p_mobile_checked boolean,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_story public.stories;
  v_id uuid;
begin
  if not (
    public.has_role(auth.uid(), 'editor')
    or public.has_role(auth.uid(), 'moderator')
    or public.has_role(auth.uid(), 'admin')
  ) then
    raise exception 'Only staff can record a launch verification';
  end if;

  select * into v_story from public.stories where id = p_story_id;
  if not found then raise exception 'No such story: %', p_story_id; end if;
  if v_story.lifecycle_status <> 'published' or v_story.published_revision_id is null then
    raise exception 'Story % is not currently published -- nothing to verify', p_story_id;
  end if;
  if not (coalesce(p_desktop_checked, false) or coalesce(p_mobile_checked, false)) then
    raise exception 'At least one of desktop or mobile must be checked';
  end if;

  insert into public.story_launch_verifications (
    story_id, revision_id, verified_by, desktop_checked, mobile_checked, note
  )
  values (
    p_story_id, v_story.published_revision_id, auth.uid(),
    coalesce(p_desktop_checked, false), coalesce(p_mobile_checked, false), nullif(trim(coalesce(p_note, '')), '')
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.record_story_launch_verification(uuid, boolean, boolean, text) is
  'Editor/moderator/admin only. Records a manual confirmation that a currently-published story was checked live (desktop/mobile). Raises if the story is not published. Purely observational -- no lifecycle/publication side effects.';

revoke execute on function public.record_story_launch_verification(uuid, boolean, boolean, text)
  from public, anon, authenticated;
grant execute on function public.record_story_launch_verification(uuid, boolean, boolean, text) to authenticated;

-- get_content_readiness_queue: one row per story (every story, any
-- lifecycle_status/source_kind, optionally filtered), with every checklist
-- signal computed from the story's currently-relevant revision
-- (current_draft_revision_id if in flight, else published_revision_id --
-- same convention get_story_preview() already uses).
create function public.get_content_readiness_queue(
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
  'Editor/moderator/admin only. Per-story founding-catalogue readiness checklist, computed from existing tables -- see this migration''s header comment for the two disclosed simplifications (attribution/consent/contributor-approval collapse to one signal; alt_text_complete is currently structurally guaranteed). Operational checklist only, not legal advice, never a publication gate. p_limit clamped to [1,50].';

revoke execute on function public.get_content_readiness_queue(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.get_content_readiness_queue(text, text, integer, integer) to authenticated;

-- get_operational_metrics: privacy-conscious aggregate counts only -- no
-- per-user breakdown, no names, no story titles. A single row.
create function public.get_operational_metrics()
returns table (
  draft_imports_count bigint,
  awaiting_contributor_approval_count bigint,
  awaiting_moderation_count bigint,
  published_count bigint,
  missing_consent_count bigint,
  images_missing_alt_text_count bigint,
  open_reports_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (
    public.has_role(auth.uid(), 'editor')
    or public.has_role(auth.uid(), 'moderator')
    or public.has_role(auth.uid(), 'admin')
  ) then
    raise exception 'Only staff can read operational metrics';
  end if;

  return query
    select
      (select count(*) from public.stories where source_kind = 'editorial_import' and lifecycle_status = 'draft'),
      (select count(*) from public.stories where lifecycle_status = 'awaiting_contributor_approval'),
      (select count(*) from public.stories where lifecycle_status = 'pending_review'),
      (select count(*) from public.stories where lifecycle_status = 'published'),
      (
        select count(*) from public.stories s
        where s.lifecycle_status in ('draft', 'awaiting_contributor_approval', 'changes_requested')
          and not exists (
            select 1 from public.story_publication_consents con
            where con.revision_id = coalesce(s.current_draft_revision_id, s.published_revision_id)
          )
      ),
      (
        select count(*) from public.story_revision_media m
        join public.story_revisions r on r.id = m.revision_id
        join public.stories s on s.id = r.story_id
        where s.current_draft_revision_id = m.revision_id
          and not m.decorative
          and (m.alt_text is null or char_length(trim(m.alt_text)) = 0)
      ),
      (select count(*) from public.story_reports where status in ('open', 'reviewing'));
end;
$$;

comment on function public.get_operational_metrics() is
  'Editor/moderator/admin only. Aggregate counts only -- draft imports, awaiting contributor approval, awaiting moderation, published, stories missing consent, images missing alt text (scoped to each story''s own current draft revision), open reports. No per-user or per-story breakdown -- not invasive tracking.';

revoke execute on function public.get_operational_metrics() from public, anon, authenticated;
grant execute on function public.get_operational_metrics() to authenticated;
