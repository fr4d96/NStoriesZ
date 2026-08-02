-- story_media: uploaded images, keyed to story_id (not revision_id) so a
-- single image can be reused across a story's revisions without
-- duplicating the file. story_revision_media: per-revision presentation
-- (alt text, caption, order, cover) — keyed to revision_id so an
-- unapproved revision's captions never leak into the published view.
--
-- Processing/approval fields (approved_public_storage_path,
-- metadata_removed_at, processed_*, sha256) are never writable by an owner
-- or editor: attach_story_media() (story_lifecycle_functions.sql) sets only
-- source-side columns; promote_story_media() is the only function that sets
-- the processed/approved ones, and it has NO grants at all in this phase
-- (see docs/architecture.md — Prompt 4 must deliberately establish the
-- trusted processor's access).

create table public.story_media (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.stories (id) on delete restrict,
  owner_user_id uuid references auth.users (id) on delete set null,
  uploaded_by uuid references auth.users (id) on delete set null,
  private_storage_path text not null,
  approved_public_storage_path text,
  source_mime_type text not null,
  processed_mime_type text,
  width integer,
  height integer,
  source_file_size_bytes bigint,
  processed_file_size_bytes bigint,
  sha256 text,
  metadata_removed_at timestamptz,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint story_media_approved_requires_metadata_removed check (
    approved_public_storage_path is null or metadata_removed_at is not null
  ),
  constraint story_media_approved_requires_processed_mime check (
    approved_public_storage_path is null or processed_mime_type is not null
  )
);

comment on table public.story_media is
  'Uploaded images, keyed to story_id (reusable across revisions). Processed/approved columns are set only by promote_story_media(), which is ungranted in this phase — no role can self-approve an image.';

create index story_media_story_id_idx on public.story_media (story_id);

alter table public.story_media enable row level security;

create table public.story_revision_media (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.story_revisions (id) on delete restrict,
  media_id uuid not null references public.story_media (id) on delete restrict,
  alt_text text,
  caption text,
  decorative boolean not null default false,
  sort_order integer not null default 0,
  is_cover boolean not null default false,
  constraint story_revision_media_unique unique (revision_id, media_id),
  constraint story_revision_media_sort_order_unique unique (revision_id, sort_order),
  constraint story_revision_media_alt_text_required check (
    decorative or (alt_text is not null and char_length(alt_text) > 0)
  ),
  constraint story_revision_media_caption_length check (
    caption is null or char_length(caption) <= 500
  ),
  constraint story_revision_media_alt_text_length check (
    alt_text is null or char_length(alt_text) <= 500
  )
);

comment on table public.story_revision_media is
  'Per-revision image presentation (order, cover, caption, alt text). Deterministic order via unique (revision_id, sort_order); at most one cover per revision via the partial unique index below.';

-- One cover per revision.
create unique index story_revision_media_one_cover_idx
  on public.story_revision_media (revision_id)
  where is_cover;

create index story_revision_media_revision_id_idx on public.story_revision_media (revision_id);
create index story_revision_media_media_id_idx on public.story_revision_media (media_id);

-- Cross-story protection: a revision may only attach media that belongs to
-- its own story (prevents reusing another story's uploaded image).
create or replace function public.story_revision_media_validate_same_story()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.story_revisions r
    join public.story_media m on m.story_id = r.story_id
    where r.id = new.revision_id and m.id = new.media_id
  ) then
    raise exception 'media % does not belong to the same story as revision %', new.media_id, new.revision_id;
  end if;
  return new;
end;
$$;

create trigger story_revision_media_validate_same_story
  before insert or update on public.story_revision_media
  for each row
  execute function public.story_revision_media_validate_same_story();

create trigger story_revision_media_protect_immutability
  before insert or update or delete on public.story_revision_media
  for each row
  execute function public._protect_revision_child_immutability();

alter table public.story_revision_media enable row level security;
-- No policies on either table — every access is a SECURITY DEFINER function.

-- Internal: raises unless every media row attached to a revision has been
-- processed AND approved. moderate_revision()'s approve path calls this —
-- an unprocessed image blocks publication structurally, with no role able
-- to fast-path around it in this phase (promote_story_media() has no
-- grants at all, see story_media table comment above).
create or replace function public._require_processed_media(p_revision_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.story_revision_media rm
    join public.story_media m on m.id = rm.media_id
    where rm.revision_id = p_revision_id
      and (m.approved_public_storage_path is null or m.metadata_removed_at is null)
  ) then
    raise exception
      'Revision % has attached media that has not been processed and approved yet', p_revision_id;
  end if;
end;
$$;

comment on function public._require_processed_media(uuid) is
  'Internal: raises unless every story_revision_media row for this revision points at a processed, approved story_media row. No API grants.';

revoke execute on function public._require_processed_media(uuid) from public, anon, authenticated;
