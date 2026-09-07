import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { createClient } from "@/lib/supabase/server";
import {
  getStoryPreview,
  getRevisionSelections,
} from "@/lib/story/contributor-queries";
import { resolveLocationLabels } from "@/lib/story/active-lookups";
import { normalizeStoryContentJson } from "@/lib/story/legacy-content";
import { storyContentText } from "@/lib/validation/story";
import { downloadMediaPreviewBytes } from "@/lib/story/image-pipeline";
import {
  buildStoryPdf,
  storyPdfFilename,
  type StoryPdfImage,
} from "@/lib/story/story-pdf";
import {
  contentDispositionAttachment,
  exportStatusLabel,
  travelStyleLabel,
  tripLabel,
} from "@/lib/story/story-export";
import { logAppEvent } from "@/lib/log";

// Node runtime, not Edge: pdfkit and sharp (via lib/story/image-pipeline.ts)
// both need real Node APIs, same reasoning as the PDF import routes.
export const runtime = "nodejs";

// Never cached, never statically generated. This can serve a private draft,
// so every request must re-authorize against the live session
// (Engineering Rules 10-13) -- the same pin the private preview page carries.
export const dynamic = "force-dynamic";

/**
 * GET /stories/:id/export -- the contributor's own copy of their story, as a
 * PDF.
 *
 * AUTHORIZATION. Two independent checks, neither of which trusts anything in
 * the URL beyond the story id:
 *
 *  1. `get_story_preview()` (via getStoryPreview) is the same private,
 *     path-free RPC the preview page uses. It re-derives the caller
 *     server-side and RAISES for anyone not entitled to the story, which is
 *     caught below as a 404.
 *  2. The relationship it reports is then narrowed to `owner` /
 *     `linked_contributor`. `assigned_editor` and `admin` can legitimately
 *     PREVIEW a draft in the review UI, but this endpoint mints a file that
 *     leaves the platform, and "download someone else's unpublished story"
 *     is not what this feature is for. Staff keep the on-screen preview.
 *
 * Every failure returns a flat 404 -- signed out, wrong person, missing
 * story and unreadable content are indistinguishable to the caller, matching
 * the convention the rest of the app uses for per-row authorization.
 *
 * Nothing here is written to the database and no storage path is ever sent to
 * the browser: images are fetched server-side by media id, each one
 * re-authorized on its own (Rules 12/13).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const user = await getCurrentUser();
  if (!user) return notFound();

  const parsedId = z.uuid().safeParse(id);
  if (!parsedId.success) return notFound();

  let preview;
  try {
    preview = await getStoryPreview(parsedId.data);
  } catch {
    return notFound();
  }
  if (!preview) return notFound();

  if (
    preview.viewerRelationship !== "owner" &&
    preview.viewerRelationship !== "linked_contributor"
  ) {
    return notFound();
  }

  const blocks = normalizeStoryContentJson(preview.contentJson);
  // A story whose content cannot be normalised still exports: the header,
  // facts and photos are the contributor's too, and refusing the whole
  // download over an unrenderable body would be the least useful possible
  // response to "let me keep a copy".
  const markdown = blocks ? storyContentText(blocks) : "";

  const selections = await getRevisionSelections(preview.revisionId);
  const locations = await resolveLocationLabels(selections.locations);

  const images = await collectImages(preview.media);

  const exportedAt = new Date();
  const pdf = await buildStoryPdf({
    title: preview.title,
    excerpt: preview.excerpt,
    attributionValue: preview.attributionValue,
    markdown,
    images,
    tripLabel: tripLabel(
      preview.tripStartDate,
      preview.tripEndDate,
      preview.tripYear,
    ),
    travelStyleLabel: travelStyleLabel(preview.travelStyle),
    locations,
    tags: selections.tags.map((tag) => tag.name),
    expenses: selections.expenses.map((expense) => ({
      name: expense.name,
      amountNzdCents: expense.amountNzdCents,
      note: expense.note,
    })),
    totalExpenseNzdCents: preview.totalExpenseNzdCents,
    statusLabel: exportStatusLabel(
      preview.lifecycleStatus,
      preview.revisionStatus,
    ),
    exportedAt,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL || "https://kakinotes.co.nz",
  });

  const asciiName = storyPdfFilename(preview.title, exportedAt);

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      // No explicit Content-Length: the body is a fixed-size buffer, so the
      // runtime sets it correctly, and a hand-set value that disagrees with
      // whatever transfer encoding Next chooses is worse than none.
      "Content-Disposition": contentDispositionAttachment(asciiName, asciiName),
      // Belt and braces with `dynamic = "force-dynamic"`: this body can be a
      // private draft, so no shared cache may ever hold it.
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * Fetches the processed derivative for each attached image, re-authorizing
 * every one individually through `authorize_story_media_preview()` on the
 * CALLER'S OWN RLS-respecting client before the admin-side download runs.
 * That is the same two-step contract mintPreviewUrlAction() follows, and the
 * reason lib/story/image-pipeline.ts is allowed to hold the admin client at
 * all: it never decides who may read what.
 *
 * A photo that fails either step is skipped rather than failing the export.
 * An image can legitimately be un-downloadable here -- still processing, or a
 * failed derivative -- and losing one photo is a far better outcome than
 * refusing a contributor their own story.
 */
async function collectImages(
  media: readonly {
    mediaId: string;
    altText: string | null;
    caption: string | null;
    decorative: boolean;
  }[],
): Promise<StoryPdfImage[]> {
  const supabase = await createClient();
  const images: StoryPdfImage[] = [];

  // Sequential, not Promise.all: each iteration is an RPC plus a full image
  // download, and a story may carry dozens. Fanning them out would open that
  // many simultaneous storage connections from a single serverless
  // invocation for no gain the contributor would notice.
  for (const item of media) {
    const { error: authError } = await supabase.rpc(
      "authorize_story_media_preview",
      { p_media_id: item.mediaId },
    );
    if (authError) continue;

    try {
      const { bytes, width, height } = await downloadMediaPreviewBytes(
        item.mediaId,
      );
      images.push({
        mediaId: item.mediaId,
        bytes,
        width,
        height,
        altText: item.altText,
        caption: item.caption,
        decorative: item.decorative,
      });
    } catch (error) {
      logAppEvent({
        event: "story-export.image_unavailable",
        target: item.mediaId,
        outcome: "error",
        detail: error instanceof Error ? error.message : "unknown error",
      });
    }
  }

  return images;
}

function notFound() {
  return NextResponse.json({ error: "Not Found" }, { status: 404 });
}
