/**
 * The contributor's choice at the end of the submit step: publish this
 * story publicly, or keep it private.
 *
 *   "public"  -> submit_revision_with_consent(). Records publication
 *                consent and puts the revision in the moderation queue.
 *                A moderator decides whether it goes live.
 *   "private" -> keep_revision_private()
 *                (supabase/migrations/20260907100100_private_stories.sql).
 *                No consent recorded, no moderator, nothing public. The
 *                revision stays an editable draft and the story's
 *                lifecycle_status becomes 'private'.
 *
 * Moderator review exists to protect what the public sees, so a story that
 * is never published publicly does not enter review at all. That is the
 * whole rule; everything else here is bookkeeping for it.
 *
 * WHY `lifecycleStatus: string` AND NOT THE GENERATED ENUM UNION.
 * The two callers disagree about the type, and `string` is the honest
 * common denominator rather than a leftover. My Stories reads
 * `list_my_stories()`'s row, whose `lifecycle_status` IS the generated enum
 * union; the preview page reads `StoryPreview`
 * (lib/story/contributor-queries.ts), which deliberately widens every
 * status to `string` so a page never has to care which enum a status came
 * from. Narrowing this parameter to the enum would break the second caller
 * and buy nothing the function name does not already say.
 *
 * (Until 20260907100100 was pushed and `npm run supabase:types:linked` run,
 * this also worked around 'private' being absent from the generated enum.
 * That reason is gone; the one above is why it stays.)
 */
export const PRIVATE_LIFECYCLE_STATUS = "private";

/** True when the contributor chose to keep this story to themselves. */
export function isPrivateStory(lifecycleStatus: string): boolean {
  return lifecycleStatus === PRIVATE_LIFECYCLE_STATUS;
}

/**
 * The two destinations the submit step offers. Used as the form value on
 * the preview page's choice control and as the discriminator the Server
 * Action switches on.
 */
export const STORY_DESTINATIONS = ["public", "private"] as const;

export type StoryDestination = (typeof STORY_DESTINATIONS)[number];
