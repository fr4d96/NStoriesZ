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
 * `types/database.ts` is generated from a live Supabase project and is
 * never hand-edited (CLAUDE.md, "Folder conventions"). It has not been
 * regenerated since 20260907100000 added 'private' to
 * story_lifecycle_status, so `Database["public"]["Enums"]["story_lifecycle_status"]`
 * still lacks the value and a direct `story.lifecycle_status === "private"`
 * fails to compile as a comparison between non-overlapping types. Widening
 * to `string` once, here, in a function whose name says exactly what it
 * tests, is the honest version of that -- the alternative is an `as string`
 * cast at each of the five call sites, which would survive the
 * regeneration and quietly outlive its reason. When `npm run
 * supabase:types:linked` is next run, this parameter can be narrowed to the
 * enum union and nothing else has to change.
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
