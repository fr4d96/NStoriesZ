import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { createDraftSchema } from "@/lib/validation/story";
import {
  pdfImportFileSchema,
  pdfImportPageNumbersSchema,
  pdfImportAltTextSchema,
} from "@/lib/validation/pdf-import";
import { attachPdfPagesToRevision } from "@/lib/story/pdf-page-attachment";
import { buildPdfImportContent } from "@/lib/story/pdf-import-content";
import { pdfPageAttachErrorMessage } from "@/lib/story/pdf-import-messages";
import {
  createSelfServiceDraftShell,
  saveRevisionDraft,
  updateStoryMediaCaption,
} from "@/lib/story/mutations";
import { getStoryPreview } from "@/lib/story/contributor-queries";
import { getErrorMessage } from "@/lib/errors";

// Node runtime (not Edge): same reasoning as pdf-preview/route.ts and
// app/(contributor)/stories/[id]/edit/upload/route.ts.
export const runtime = "nodejs";

/**
 * Contributor-facing twin of app/(editor)/editorial/new/pdf-attach/route.ts
 * — same Phase B (re-upload the same PDF bytes + selected page numbers +
 * per-page alt text -> create the draft and attach the pages as images)
 * behavior, but for a contributor's own self-service draft rather than an
 * editorial import: no contributor-selection fields (the signed-in
 * contributor IS the contributor), and the shell is created via
 * `createSelfServiceDraftShell` (create_self_service_draft) instead of
 * `create_editorial_import_draft`.
 *
 * POST /stories/new/pdf-attach -- multipart form fields:
 *   file          the SAME raw PDF bytes Phase A rendered previews from
 *   pageNumbers   JSON-encoded array of selected page numbers
 *   altText       OPTIONAL JSON-encoded { [pageNumber]: string } map
 *   title         required
 *
 * Server-side re-validation (Engineering Rule 2): a fresh, independently
 * authenticated request -- Phase A's validation of this same file buys this
 * handler nothing; magic bytes/size and the page selection are re-checked
 * here exactly as the editorial route does.
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: "You must be signed in." },
      { status: 401 },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  }

  const titleParsed = createDraftSchema.safeParse({
    title: formData.get("title"),
  });
  if (!titleParsed.success) {
    return NextResponse.json(
      { error: titleParsed.error.issues[0]?.message ?? "Invalid title." },
      { status: 400 },
    );
  }

  let pageNumbersRaw: unknown;
  try {
    const field = formData.get("pageNumbers");
    if (typeof field !== "string") throw new Error("missing");
    pageNumbersRaw = JSON.parse(field);
  } catch {
    return NextResponse.json(
      { error: "Missing or invalid page selection." },
      { status: 400 },
    );
  }
  const pageNumbersParsed =
    pdfImportPageNumbersSchema.safeParse(pageNumbersRaw);
  if (!pageNumbersParsed.success) {
    return NextResponse.json(
      {
        error:
          pageNumbersParsed.error.issues[0]?.message ??
          "Invalid page selection.",
      },
      { status: 400 },
    );
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file." }, { status: 400 });
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  const fileParsed = pdfImportFileSchema.safeParse({ bytes });
  if (!fileParsed.success) {
    return NextResponse.json(
      { error: fileParsed.error.issues[0]?.message ?? "Invalid PDF file." },
      { status: 400 },
    );
  }

  // Optional and best-effort, same reasoning as the editorial route: a
  // missing or malformed field just leaves every attached page's alt text
  // unset (decorative=true placeholder) rather than failing the request.
  let altTextMap: Record<string, string> = {};
  const altTextRaw = formData.get("altText");
  if (typeof altTextRaw === "string" && altTextRaw.length > 0) {
    try {
      const altTextParsed = pdfImportAltTextSchema.safeParse(
        JSON.parse(altTextRaw),
      );
      if (altTextParsed.success) {
        altTextMap = altTextParsed.data;
      }
    } catch {
      // Malformed JSON -- ignore, same reasoning as an unparseable schema.
    }
  }

  let storyId: string;
  let revisionId: string;
  try {
    const created = await createSelfServiceDraftShell(titleParsed.data.title);
    if (!created) {
      return NextResponse.json(
        { error: "Could not create your story." },
        { status: 400 },
      );
    }
    storyId = created.story_id;
    revisionId = created.revision_id;
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Could not create your story.") },
      { status: 400 },
    );
  }

  // A freshly created draft's story.version is always 1
  // (supabase/migrations/20260803090100_stories.sql).
  const attachResult = await attachPdfPagesToRevision({
    bytes,
    pageNumbers: pageNumbersParsed.data,
    storyId,
    revisionId,
    expectedVersion: 1,
  });
  if (!attachResult.ok) {
    return NextResponse.json(
      { error: pdfPageAttachErrorMessage(attachResult.error), storyId },
      { status: 400 },
    );
  }

  let version: number;
  try {
    const preview = await getStoryPreview(storyId);
    if (!preview) {
      return NextResponse.json(
        { error: "Could not load your story after attaching images.", storyId },
        { status: 500 },
      );
    }
    version = preview.version;
  } catch (error) {
    return NextResponse.json(
      {
        error: getErrorMessage(
          error,
          "Could not load your story after attaching images.",
        ),
        storyId,
      },
      { status: 500 },
    );
  }

  for (const page of attachResult.attached) {
    const text = altTextMap[String(page.pageNumber)];
    if (!text) continue;
    try {
      await updateStoryMediaCaption({
        revisionId,
        mediaId: page.mediaId,
        expectedVersion: version,
        altText: text,
        caption: null,
        decorative: false,
      });
      version += 1;
    } catch {
      break;
    }
  }

  const { contentJson } = buildPdfImportContent(
    attachResult.attached.map((page) => page.mediaId),
    file.name,
  );

  try {
    await saveRevisionDraft(revisionId, version, {
      title: titleParsed.data.title,
      excerpt: "",
      contentJson,
      tripStartDate: "",
      tripEndDate: "",
      travelStyle: "",
      contributorNote: "",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: getErrorMessage(
          error,
          "Images were attached, but the story text could not be saved. Open the draft to finish it.",
        ),
        storyId,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    storyId,
    revisionId,
    attachedCount: attachResult.attached.length,
    duplicatePages: attachResult.attached
      .filter((page) => page.isDuplicate)
      .map((page) => page.pageNumber),
  });
}
