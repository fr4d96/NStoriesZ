// Pre-loaded emoji avatar set (Prompt: "start with some pre-loaded emoji
// icons"). Deliberately duplicated in
// supabase/migrations/*_profile_avatar_emoji.sql's CHECK constraint —
// same pattern as lib/validation/profile.ts's slug/country-code regexes:
// Zod here for fast/friendly form errors, the DB constraint as the
// non-bypassable source of truth (Engineering Rule 3). If this list ever
// changes, that migration's constraint must be updated to match via a new
// migration (not edited in place).
export const AVATAR_EMOJI_OPTIONS = [
  "🌏",
  "🧳",
  "🎒",
  "🥾",
  "🍏",
  "🍇",
  "🐑",
  "🚜",
  "⛰️",
  "🌊",
  "🏕️",
  "☕",
  "🚐",
  "🌅",
  "🦘",
  "🥝",
  "🏔️",
  "🌲",
  "🛶",
  "🏄",
  "🐧",
  "🦙",
  "🌻",
  "🍷",
] as const;

export type AvatarEmoji = (typeof AVATAR_EMOJI_OPTIONS)[number];
