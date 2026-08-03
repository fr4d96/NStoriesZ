-- Prompt 4: extends story_media with the media processing-state machine
-- (pending_upload -> uploaded -> processing -> processed/failed ->
-- promotion_pending -> promoted). See docs/architecture.md "Media processing
-- pipeline" for the full design and rationale.
--
-- Column renames/additions:
--   - width/height (Prompt 3) renamed to processed_width/processed_height:
--     these were always set together with processed_mime_type/sha256 by the
--     original single-step promote_story_media(), i.e. they always described
--     the PROCESSED derivative, never the original upload — the rename makes
--     that explicit rather than ambiguous.
--   - source_width/source_height (new): the original upload's dimensions,
--     detected via a real decode during processing — NOT client-supplied,
--     and NOT known at upload time (establishing them requires decoding,
--     which only happens in the processing step). Deliberately nullable
--     until processing succeeds.
--   - processed_private_storage_path (new): the private-bucket staging
--     location for the processed derivative, written before any public-
--     bucket copy is attempted (see story_media_public_copy_attempts).
--   - reserved_for_revision_id (new): the revision that reserved this media
--     slot at begin_story_media_upload() time. Pure provenance once the
--     story_revision_media join row exists; used to count pending
--     reservations against the 12-image-per-revision limit before that join
--     exists.
--   - processing_state (new): the explicit state machine driving every
--     other column's validity (see the CHECK constraints and the transition
--     trigger below).

create type public.story_media_processing_state as enum (
  'pending_upload',
  'uploaded',
  'processing',
  'processed',
  'failed',
  'promotion_pending',
  'promoted'
);

alter table public.story_media
  rename column width to processed_width;
alter table public.story_media
  rename column height to processed_height;

alter table public.story_media
  add column source_width integer,
  add column source_height integer,
  add column processed_private_storage_path text,
  add column reserved_for_revision_id uuid references public.story_revisions (id) on delete set null,
  add column processing_state public.story_media_processing_state not null default 'pending_upload',
  add column processing_started_at timestamptz,
  add column failure_reason text,
  add column error_code text;

comment on column public.story_media.processed_width is
  'Processed derivative''s width, detected via a real decode during processing. Set only by record_processed_story_media().';
comment on column public.story_media.processed_height is
  'Processed derivative''s height, detected via a real decode during processing. Set only by record_processed_story_media().';
comment on column public.story_media.source_width is
  'Original upload''s width, detected via a real decode during processing (NOT client-supplied, NOT known at upload time). Set only by record_processed_story_media().';
comment on column public.story_media.source_height is
  'Original upload''s height, detected via a real decode during processing. Set only by record_processed_story_media().';
comment on column public.story_media.processed_private_storage_path is
  'Private-bucket staging location for the processed derivative. Never the public bucket — promotion only copies from here to story-images-public, and only during a moderator-finalized publication.';
comment on column public.story_media.reserved_for_revision_id is
  'The revision that reserved this media slot at begin_story_media_upload() time. Used to count pending reservations toward the 12-image-per-revision limit before the story_revision_media join row exists.';
comment on column public.story_media.processing_state is
  'Explicit state machine: pending_upload -> uploaded -> processing -> processed|failed -> promotion_pending -> promoted. See story_media_validate_processing_state_transition() and the state-dependent CHECK constraints below.';

-- State-dependent constraints: a state cannot exist without its required
-- fields, and earlier states cannot carry authoritative processed/public
-- data (a retry from `failed` starts clean, never with stale prior data).
alter table public.story_media
  add constraint story_media_approved_path_requires_promoted check (
    (approved_public_storage_path is not null) = (processing_state = 'promoted')
  ),
  add constraint story_media_processed_fields_require_processed_or_later check (
    (
      processed_private_storage_path is not null
      and processed_mime_type is not null
      and processed_file_size_bytes is not null
      and processed_width is not null
      and processed_height is not null
      and sha256 is not null
      and metadata_removed_at is not null
      and source_mime_type is not null
      and source_width is not null
      and source_height is not null
    ) = (processing_state in ('processed', 'promotion_pending', 'promoted'))
  ),
  add constraint story_media_source_size_requires_uploaded_or_later check (
    (source_file_size_bytes is not null) = (processing_state <> 'pending_upload')
  ),
  add constraint story_media_processing_started_requires_processing_or_later check (
    (processing_started_at is not null) = (
      processing_state in ('processing', 'processed', 'failed', 'promotion_pending', 'promoted')
    )
  ),
  add constraint story_media_failure_fields_require_failed check (
    (failure_reason is not null or error_code is not null) = (processing_state = 'failed')
  );

-- Old Prompt 3 constraints referenced approved_public_storage_path/
-- metadata_removed_at/processed_mime_type directly; superseded by the
-- state-dependent constraints above, which are strictly more precise.
alter table public.story_media
  drop constraint story_media_approved_requires_metadata_removed,
  drop constraint story_media_approved_requires_processed_mime;

create index story_media_reserved_for_revision_id_idx
  on public.story_media (reserved_for_revision_id)
  where processing_state = 'pending_upload';

-- Valid processing-state transitions, enforced regardless of which function
-- (present or future) attempts them — matches
-- story_revisions_protect_immutable_content()'s pattern of a DB-level
-- invariant that isn't merely convention. `promoted` is immutable: a
-- same-state `promoted -> promoted` update is only allowed if every
-- recorded value is unchanged (an idempotent no-op retry), never a real
-- mutation.
create or replace function public.story_media_validate_processing_state_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.processing_state = new.processing_state then
    if old.processing_state = 'promoted' then
      if new.approved_public_storage_path is distinct from old.approved_public_storage_path
        or new.processed_private_storage_path is distinct from old.processed_private_storage_path
        or new.processed_mime_type is distinct from old.processed_mime_type
        or new.processed_file_size_bytes is distinct from old.processed_file_size_bytes
        or new.processed_width is distinct from old.processed_width
        or new.processed_height is distinct from old.processed_height
        or new.sha256 is distinct from old.sha256
      then
        raise exception 'story_media % is promoted and its recorded values are immutable', old.id;
      end if;
    end if;
    return new;
  end if;

  if not (
    (old.processing_state = 'pending_upload' and new.processing_state = 'uploaded')
    or (old.processing_state = 'uploaded' and new.processing_state = 'processing')
    or (old.processing_state = 'processing' and new.processing_state in ('processed', 'failed'))
    or (old.processing_state = 'failed' and new.processing_state = 'processing')
    or (old.processing_state = 'processed' and new.processing_state = 'promotion_pending')
    or (old.processing_state = 'promotion_pending' and new.processing_state in ('processed', 'promoted'))
  ) then
    raise exception 'story_media % cannot transition from % to %', old.id, old.processing_state, new.processing_state;
  end if;

  return new;
end;
$$;

create trigger story_media_validate_processing_state_transition
  before update on public.story_media
  for each row
  execute function public.story_media_validate_processing_state_transition();
