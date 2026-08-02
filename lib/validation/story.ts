import { z } from "zod";

// Controlled story content — text blocks only (Engineering Rule 6/7). No
// inline image blocks: images render as an ordered gallery from
// story_revision_media, kept deliberately separate to avoid duplicate state
// between content_json and the media table (see docs/architecture.md).
const paragraphBlockSchema = z.object({
  type: z.literal("paragraph"),
  text: z.string().trim().min(1).max(5000),
});

const headingBlockSchema = z.object({
  type: z.literal("heading"),
  level: z.union([z.literal(2), z.literal(3)]),
  text: z.string().trim().min(1).max(200),
});

const quoteBlockSchema = z.object({
  type: z.literal("quote"),
  text: z.string().trim().min(1).max(2000),
});

const listBlockSchema = z.object({
  type: z.literal("list"),
  style: z.enum(["ordered", "unordered"]),
  items: z.array(z.string().trim().min(1).max(1000)).min(1).max(50),
});

export const storyContentBlockSchema = z.discriminatedUnion("type", [
  paragraphBlockSchema,
  headingBlockSchema,
  quoteBlockSchema,
  listBlockSchema,
]);

export type StoryContentBlock = z.infer<typeof storyContentBlockSchema>;

export const storyContentSchema = z.array(storyContentBlockSchema).max(200);

// Mirrors supabase/migrations/20260803090200_story_revisions.sql's CHECK
// constraints — duplicated deliberately for fast/friendly form errors; the
// DB constraints (and the immutability trigger) are the non-bypassable
// source of truth per Engineering Rule 3.
export const travelStyles = ["budget", "mid_range", "comfort"] as const;

export const revisionInputSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required.").max(200),
    excerpt: z.string().trim().max(500).optional().or(z.literal("")),
    contentJson: storyContentSchema,
    tripStartDate: z.iso.date().optional().or(z.literal("")),
    tripEndDate: z.iso.date().optional().or(z.literal("")),
    tripYear: z.number().int().min(2000).max(2100).optional(),
    travelStyle: z.enum(travelStyles).optional(),
    totalExpenseNzdCents: z.number().int().min(0).optional(),
    contributorNote: z.string().trim().max(2000).optional().or(z.literal("")),
  })
  .refine(
    (data) =>
      !data.tripStartDate ||
      !data.tripEndDate ||
      data.tripStartDate <= data.tripEndDate,
    {
      message: "Trip start date must be on or before the end date.",
      path: ["tripEndDate"],
    },
  );

export type RevisionInput = z.infer<typeof revisionInputSchema>;

export const confirmationMethods = [
  "account",
  "email",
  "written_message",
  "in_person",
  "other",
] as const;

export const identifiablePeopleStates = [
  "confirmed",
  "not_applicable",
  "pending",
  "declined",
] as const;

export const submitRevisionSchema = z.object({
  revisionId: z.uuid(),
  expectedVersion: z.number().int(),
  confirmationMethod: z.enum(confirmationMethods),
  publicationConfirmed: z.literal(true, {
    error: "You must confirm you have permission to publish this story.",
  }),
  imageRightsConfirmed: z.boolean().default(false),
  identifiablePeopleState: z.enum(identifiablePeopleStates).default("pending"),
  editorialAssistanceConfirmed: z.boolean().default(false),
});

export type SubmitRevisionInput = z.infer<typeof submitRevisionSchema>;

export const reportCategories = [
  "misinformation",
  "unsafe_employment_advice",
  "harassment",
  "copyright_privacy",
  "spam_commercial",
  "other",
] as const;

export const createReportSchema = z.object({
  storyId: z.uuid(),
  category: z.enum(reportCategories),
  details: z.string().trim().max(2000).optional().or(z.literal("")),
});

export type CreateReportInput = z.infer<typeof createReportSchema>;
