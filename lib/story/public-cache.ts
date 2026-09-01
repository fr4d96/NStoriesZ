import "server-only";
import { revalidatePath } from "next/cache";

// Prompt 5's public pages all read through the cookie-free client in
// lib/supabase/public.ts, but they do NOT all cache, and the difference
// matters when reasoning about staleness:
//
//   - app/(public)/page.tsx        -- `revalidate = 60`, builds `○` static.
//   - app/(public)/stories/[id]    -- `revalidate = 60`, ISR-cached per path
//   - app/(public)/contributors/[slug]   at runtime (they show `ƒ` in the
//                                        build table only because they have
//                                        no generateStaticParams to
//                                        prerender from).
//   - app/(public)/stories         -- NO caching. Both await searchParams,
//   - app/(public)/contributors       which forces dynamic rendering, so a
//                                     `revalidate` export would be a no-op
//                                     and has been removed. These two are
//                                     re-queried on every single request
//                                     and are therefore always fresh.
//
// So the three cached surfaces are eventually consistent within a minute on
// their own; the two index pages need no invalidation at all. These helpers
// are for *on-demand* invalidation the moment public visibility actually
// changes -- revalidatePath() on an uncached path is simply a harmless
// no-op, which is why the lists below still name /stories and /contributors
// rather than special-casing them.
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
//   - the slug cannot be re-derived server-side (a caller must NEVER trust a
//     client-supplied slug, per Engineering Rule 2, so this is a real case:
//     archiving a long-published story with no in-flight revision has no
//     moderator-readable slug source) -> invalidateStoryListingsPublicCache()
//
// That last entry is the point of splitting the two functions below. Doing
// nothing at all when the slug is unknown is NOT an acceptable fallback for a
// visibility change: /stories, / and the sitemap are exactly the surfaces that
// keep advertising a story that just went private (Engineering Rule 12), and
// they need no slug to purge. Only the /stories/[slug] detail page does.

/**
 * Every public surface that lists stories but is not slug-specific. Safe to
 * call when the slug is unknown; it is a strict subset of
 * invalidateStoryPublicCache() below, which is why that one delegates here
 * rather than repeating the path list.
 */
export function invalidateStoryListingsPublicCache() {
  revalidatePath("/stories");
  revalidatePath("/");
  revalidatePath("/sitemap.xml");
}

export function invalidateStoryPublicCache(slug: string) {
  revalidatePath(`/stories/${slug}`);
  invalidateStoryListingsPublicCache();
}

export function invalidateContributorPublicCache(contributorSlug: string) {
  revalidatePath(`/contributors/${contributorSlug}`);
  revalidatePath("/contributors");
  revalidatePath("/sitemap.xml");
}
