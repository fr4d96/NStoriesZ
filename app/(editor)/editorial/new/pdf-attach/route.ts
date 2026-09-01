import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUserRole, resolveStaffAccess } from "@/lib/auth/roles";
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
  createEditorialImportDraftShell,
  saveRevisionDraft,
  updateStoryMediaCaption,
} from "@/lib/story/mutations";
import { getStoryPreview } from "@/lib/story/contributor-queries";
import { resolveContributorIdFromFormData } from "../actions";
import { getErrorMessage } from "@/lib/errors";
import { logAppEvent } from "@/lib/log";

// Node runtime (not Edge): same reasoning as pdf-preview/route.ts and
// app/(contributor)/stories/[id]/edit/upload-actions.ts.
export const runtime = "nodejs";

/**
 * Phase B of docs/pdf-canva-import-plan.md's Stage 4.
 *
 * POST /editorial/new/pdf-attach -- multipart form fields:
 *   file                     the SAME raw PDF bytes Phase A rendered
 *                             previews from (see below for why it is
 *                             re-uploaded rather than cached server-side)
 *   pageNumbers               JSON-encoded array of the editor's selected
 *                             page numbers, e.g. "[3,1,7]" (order = the
 *                             order pages will be attached and embedded in)
 *   altText                   OPTIONAL JSON-encoded object mapping each
 *                             selected page number (as a string key) to its
 *                             editor-written alt text, e.g.
 *                             '{"3":"Passport stamp page","1":"..."}' --
 *                             Stage 5's page-picker UI collects this
 *                             per-selected-page before submission. A page
 *                             number missing from this map, or a wholly
 *                             absent/malformed field, is not a request
 *                             failure -- that page's image simply stays
 *                             `decorative = true` (the placeholder every
 *                             attached page already gets, see
 *                             attachPdfPagesToRevision()'s own comment)
 *                             until an editor fills in alt text later in
 *                             the real editor. This is a UX nicety on top
 *                             of, never a replacement for, the existing
 *                             submit-time `missingRequirements` alt-text
 *                             gate.
 *   title                     same required field as the existing
 *                             single-phase importer
 *   contributorMode / existingContributorId / newContributorDisplayName /
 *   newContributorAttributionType   identical to createEditorialImportAction
 *                             (app/(editor)/editorial/new/actions.ts) --
 *                             parsed by the same
 *                             resolveContributorIdFromFormData() helper so
 *                             the two flows can never validate this
 *                             differently
 *
 * PDF-bytes-across-phases: the plan's own preferred, simplest option --
 * "the client re-submits the original file alongside its page selection in
 * Phase B, avoiding any server-side temp-file/session-cache design
 * entirely." No PDF bytes, in whole or in part, are ever held in a
 * server-side cache/session/temp file between Phase A and Phase B; the only
 * thing that survives is whatever state the browser tab already holds (the
 * originally-selected File object) plus which page numbers the editor
 * picked from Phase A's response. This keeps Ground Rule 6 (never persist
 * the source PDF) trivially true across two requests instead of needing a
 * new expiring-cache mechanism.
 *
 * Server-side re-validation (Engineering Rule 2): this is a fresh,
 * independently-authenticated request -- Phase A's validation of this same
 * file buys this handler nothing. Magic bytes/size are re-checked via
 * `pdfImportFileSchema` below exactly as Phase A does, and the page
 * selection is re-checked against the PDF's ACTUAL page count by
 * `attachPdfPagesToRevision()` -> `renderPagesAtFullQuality()`
 * (lib/story/pdf-import.ts), which independently re-parses the re-uploaded
 * bytes and rejects any out-of-range page number
 * (`invalid_page_numbers`) -- never trusting Phase A's client-side claim
 * about how many pages exist or which ones were previewable.
 *
 * Draft-creation ordering: the draft/revision shell is created up front
 * (via the same `createEditorialImportDraftShell` /
 * `create_editorial_import_draft` RPC `createEditorialImportAction` already
 * uses) BEFORE pages are rendered/attached, because
 * `attachPdfPagesToRevision()` needs a real `revisionId` to attach to (it
 * drives the exact same begin_/finalize_story_media_upload sequence a
 * manual upload uses). If the attach step fails partway or entirely, the
 * title-only shell is left behind exactly as it would be if an editor used
 * today's single-phase importer and then abandoned the next step before
 * adding any photos -- not a new failure mode this endpoint introduces, and
 * recoverable the same way (the editor can revisit `/editorial/:id/edit`
 * and add images manually, or discard the draft).
 *
 * Auth: identical editor/admin check to `createEditorialImportAction` --
 * Route Handlers are not covered by the `(editor)` layout's role guard.
 */
export async function POST(request: NextRequest) {
  const role = await getCurrentUserRole();
  const access = resolveStaffAccess(role, ["editor", "admin"]);
  if (!access.ok) {
    return NextResponse.json(
      { error: "Only an editor or admin can start an editorial import." },
      { status: 403 },
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

  // Stage 5's alt-text map -- optional and best-effort, see this file's own
  // doc comment above. A missing or malformed field is never a request
  // failure; the request just proceeds with an empty map, leaving every
  // attached page's alt text unset (decorative=true placeholder, unchanged
  // from Stage 4's behavior).
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

  const resolvedContributor = await resolveContributorIdFromFormData(formData);
  if (!resolvedContributor.ok) {
    return NextResponse.json(
      { error: resolvedContributor.error },
      { status: 400 },
    );
  }

  let storyId: string;
  let revisionId: string;
  try {
    const created = await createEditorialImportDraftShell(
      resolvedContributor.contributorId,
      titleParsed.data.title,
    );
    if (!created) {
      return NextResponse.json(
        { error: "Could not create the import draft." },
        { status: 400 },
      );
    }
    storyId = created.story_id;
    revisionId = created.revision_id;
  } catch (error) {
    return NextResponse.json(
      {
        error: getErrorMessage(error, "Could not create the import draft."),
      },
      { status: 400 },
    );
  }

  // A freshly created draft's story.version is always 1
  // (supabase/migrations/20260803090100_stories.sql), same assumption
  // app/(contributor)/stories/new/ relies on for a brand-new shell.
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

  // Re-fetch the authoritative post-attach version rather than assuming
  // "1 + number of pages attached" -- attachPdfPagesToRevision()'s own
  // return value doesn't carry it, and re-deriving it from a fresh
  // get_story_preview() call is the same "ask the server, don't compute it
  // yourself" posture every other version-dependent call in this codebase
  // already follows.
  let version: number;
  try {
    const preview = await getStoryPreview(storyId);
    if (!preview) {
      return NextResponse.json(
        { error: "Could not load the draft after attaching images.", storyId },
        { status: 500 },
      );
    }
    version = preview.version;
  } catch (error) {
    return NextResponse.json(
      {
        error: getErrorMessage(
          error,
          "Could not load the draft after attaching images.",
        ),
        storyId,
      },
      { status: 500 },
    );
  }

  // Apply Stage 5's per-page alt text now that real mediaIds exist (they
  // don't until attachPdfPagesToRevision() returns above). Reuses
  // update_story_media_caption -- the exact same RPC
  // components/story/image-upload-manager.tsx's caption/alt-text editing
  // already calls via updateStoryMediaCaption() -- rather than inventing a
  // second alt-text-setting mechanism. Sequential and best-effort: each
  // call bumps the authoring version by one (same as every other mutation
  // here), so `version` is threaded through by hand; if a call fails
  // partway (e.g. an unexpected concurrent edit on a draft that, at this
  // point in the request, no other actor should be touching yet), the loop
  // stops but the request still proceeds to save the draft -- alt text is a
  // UX nicety on top of, never a precondition for, the draft existing (see
  // this route's own doc comment on `altText`).
  //
  // That stop is now LOGGED rather than silent, matching the contributor twin
  // (app/(contributor)/stories/new/pdf-attach/route.ts). logAppEvent, not
  // logStaffAction, even though this route is editor/admin-gated: it is the
  // same event as the contributor route's, and splitting one event across two
  // log scopes would make it harder to query, not easier. Nothing surfaces it
  // to the editor yet -- see the contributor twin for why that needs a UI
  // decision first.
  let altTextApplied = 0;
  const altTextRequested = attachResult.attached.filter(
    (page) => altTextMap[String(page.pageNumber)],
  ).length;
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
      altTextApplied += 1;
    } catch {
      break;
    }
  }
  if (altTextApplied < altTextRequested) {
    logAppEvent({
      event: "pdf-import.alt_text_partial",
      target: storyId,
      outcome: "error",
      detail: `applied ${altTextApplied} of ${altTextRequested}`,
    });
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
