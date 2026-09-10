import { z } from "zod";
import { AVATAR_EMOJI_OPTIONS } from "@/lib/avatar";

// Mirrors the CHECK constraints in supabase/migrations/*_profiles.sql —
// duplicated deliberately (Zod for fast/friendly form errors, the DB
// constraint as the non-bypassable source of truth per Engineering Rule 3).
const slugPattern = /^[a-z0-9][a-z0-9-]{2,59}$/;
const countryCodePattern = /^[A-Z]{2}$/;

// contributors.public_slug only. Until 20260910090000 this was shared with
// profiles.public_slug as well -- two opt-ins on two tables, the second of
// which no route ever resolved (docs/implementation-status.md "Known
// assumptions" #8, now closed). profiles no longer carries a public slug.
const publicSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    slugPattern,
    "Use 3-60 lowercase letters, numbers, or hyphens, starting with a letter or number.",
  )
  .optional()
  .or(z.literal(""));

// The ACCOUNT record, not the public one. Everything a reader can see --
// bio, avatar, home country, the directory opt-in and the slug -- now lives
// on createOwnContributorSchema below, because `contributors` is what
// /contributors/[slug] actually reads and is the only one of the two tables
// that can exist for an editor-imported contributor with no user account.
export const profileUpdateSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, "Display name is required.")
    .max(120, "Display name must be 120 characters or fewer."),
});

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;

export const contributorAttributionTypes = [
  "real_name",
  "display_name",
  "pseudonym",
  "anonymous",
] as const;

export const createOwnContributorSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, "Display name is required.")
    .max(120, "Display name must be 120 characters or fewer."),
  attributionType: z.enum(contributorAttributionTypes),
  // contributors.public_status/public_slug -- controls whether this
  // contributor shows up in the /contributors directory and gets a real
  // /contributors/:slug page. As of 20260910090000 this is the ONLY such
  // opt-in; profiles no longer has a competing one.
  publicProfileEnabled: z.boolean(),
  publicSlug: publicSlugSchema,
  bio: z
    .string()
    .trim()
    .max(2000, "Bio must be 2000 characters or fewer.")
    .optional()
    .or(z.literal("")),
  // Optional here, unlike the old profiles field which defaulted to MY. An
  // unset home country renders as absent on the public page rather than as
  // a guess -- see the column comment in 20260910090000.
  homeCountryCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(countryCodePattern, "Use a 2-letter country code, e.g. MY.")
    .optional()
    .or(z.literal("")),
  avatarEmoji: z
    .enum(AVATAR_EMOJI_OPTIONS, {
      message: "Choose one of the provided avatars.",
    })
    .optional()
    .or(z.literal("")),
});

export type CreateOwnContributorInput = z.infer<
  typeof createOwnContributorSchema
>;
