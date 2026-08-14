import { z } from "zod";
import { AVATAR_EMOJI_OPTIONS } from "@/lib/avatar";

// Mirrors the CHECK constraints in supabase/migrations/*_profiles.sql —
// duplicated deliberately (Zod for fast/friendly form errors, the DB
// constraint as the non-bypassable source of truth per Engineering Rule 3).
const slugPattern = /^[a-z0-9][a-z0-9-]{2,59}$/;
const countryCodePattern = /^[A-Z]{2}$/;

export const profileUpdateSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, "Display name is required.")
    .max(120, "Display name must be 120 characters or fewer."),
  bio: z
    .string()
    .trim()
    .max(2000, "Bio must be 2000 characters or fewer.")
    .optional()
    .or(z.literal("")),
  homeCountryCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(countryCodePattern, "Use a 2-letter country code, e.g. MY."),
  publicProfileEnabled: z.boolean(),
  publicSlug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      slugPattern,
      "Use 3-60 lowercase letters, numbers, or hyphens, starting with a letter or number.",
    )
    .optional()
    .or(z.literal("")),
  avatarEmoji: z
    .enum(AVATAR_EMOJI_OPTIONS, {
      message: "Choose one of the provided avatars.",
    })
    .optional()
    .or(z.literal("")),
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
});

export type CreateOwnContributorInput = z.infer<
  typeof createOwnContributorSchema
>;
