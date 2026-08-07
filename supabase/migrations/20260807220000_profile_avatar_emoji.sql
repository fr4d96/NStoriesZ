-- Pre-loaded emoji avatar picker (self-service, any signed-in user).
-- Deliberately a separate column from the existing `avatar_path` (reserved
-- for a possible future real image-upload avatar, which would need the
-- same private-bucket/processed-derivative/EXIF-stripping pipeline the
-- story-media system already has -- out of scope here). The allowed set is
-- duplicated from lib/avatar.ts's AVATAR_EMOJI_OPTIONS -- see that file's
-- header comment for why (Engineering Rule 3: Zod for friendly errors, this
-- CHECK as the non-bypassable source of truth).
alter table public.profiles
  add column avatar_emoji text;

alter table public.profiles
  add constraint profiles_avatar_emoji_allowed check (
    avatar_emoji is null or avatar_emoji in (
      '🌏', '🧳', '🎒', '🥾', '🍏', '🍇', '🐑', '🚜', '⛰️', '🌊',
      '🏕️', '☕', '🚐', '🌅', '🦘', '🥝', '🏔️', '🌲', '🛶', '🏄',
      '🐧', '🦙', '🌻', '🍷'
    )
  );

comment on column public.profiles.avatar_emoji is
  'Self-service emoji avatar, chosen from a fixed pre-loaded set (see the CHECK constraint + lib/avatar.ts). Null falls back to the app''s default avatar treatment.';

-- No RLS policy changes needed: the existing "profiles: owner updates own
-- profile" / "profiles: owner reads own profile" policies already cover
-- this new column (RLS is table/row-scoped, not column-scoped), and the
-- existing public-read policy (opted-in + slug) already applies too, so a
-- public profile's avatar is visible wherever the rest of the public
-- profile already is.
