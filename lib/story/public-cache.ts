import "server-only";
import { revalidatePath } from "next/cache";

// Prompt 5's public pages (app/(public)/stories, .../[slug],
// app/(public)/contributors, .../[slug], app/(public)/page.tsx) all read
// through the cookie-free client in lib/supabase/public.ts and carry
// `export const revalidate = 60`, so they're already eventually consistent
// within a minute without any of this. These helpers are for *on-demand*
// invalidation the moment public visibility actually changes.
//
// Deliberately NOT called from lib/story/moderation.ts's archiveStory() or
// lib/story/mutations.ts's revokePublicationConsent() -- both are reusable
// domain/repository functions, and revalidatePath/revalidateTag belong at
// the Server Action or Route Handler orchestration boundary that calls
// them, not inside the reusable function itself (a function like
// archiveStory() may end up called from more than one place, e.g. a
// contributor-initiated withdrawal vs. a staff action, and each caller
// knows its own routing/paths better than the shared function should).
//
// Neither archiveStory() nor revokePublicationConsent() has a real UI
// caller yet (grepped, confirmed at the time this was written) -- Prompt 6
// (moderation workspace) is what will add the actual Server Actions for
// publish/archive, and any future contributor-facing withdrawal UI is what
// will call revokePublicationConsent(). Each of those new Server Actions
// must call the matching helper below immediately after its mutation
// succeeds:
//
//   - finalize_story_publication() succeeds -> invalidateStoryPublicCache(slug)
//   - archiveStory() succeeds               -> invalidateStoryPublicCache(slug)
//   - revokePublicationConsent() succeeds   -> invalidateStoryPublicCache(slug)
//   - a slug change is ever supported       -> invalidate both old and new slugs

export function invalidateStoryPublicCache(slug: string) {
  revalidatePath(`/stories/${slug}`);
  revalidatePath("/stories");
  revalidatePath("/");
  revalidatePath("/sitemap.xml");
}

export function invalidateContributorPublicCache(contributorSlug: string) {
  revalidatePath(`/contributors/${contributorSlug}`);
  revalidatePath("/contributors");
  revalidatePath("/sitemap.xml");
}
