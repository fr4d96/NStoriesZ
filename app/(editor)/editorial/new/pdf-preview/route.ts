import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUserRole, resolveStaffAccess } from "@/lib/auth/roles";
import { pdfImportFileSchema } from "@/lib/validation/pdf-import";
import { renderPagePreviews } from "@/lib/story/pdf-import";
import { pdfImportErrorMessage } from "@/lib/story/pdf-import-messages";

// Node runtime (not Edge): pdfjs-dist/@napi-rs/canvas (lib/story/pdf-import.ts)
// need real Node APIs, same reasoning as
// app/(contributor)/stories/[id]/edit/upload-actions.ts's own runtime pin.
export const runtime = "nodejs";

/**
 * Phase A of docs/pdf-canva-import-plan.md's Stage 4 (two-phase PDF/Canva
 * import: preview -> select -> attach).
 *
 * POST /editorial/new/pdf-preview -- multipart form field: `file` (the raw
 * PDF). A Route Handler, not a Server Action, for the same reason
 * app/(contributor)/stories/[id]/edit/upload-actions.ts is: Server Actions
 * are bound by next.config.ts's `experimental.serverActions.bodySizeLimit`
 * (currently 2.5mb, sized for the separate text/HTML importer) regardless
 * of any in-code check, and MAX_PDF_IMPORT_INPUT_BYTES (75 MiB,
 * lib/story/pdf-validation.ts) was deliberately left unwired from that
 * config for exactly this reason -- see that constant's own doc comment.
 *
 * Renders every page (up to MAX_PDF_IMPORT_PAGES) to a preview-resolution
 * PNG via Stage 1's `renderPagePreviews()` and returns them as base64 data
 * URLs -- the simplest response shape for thumbnails that only need to
 * survive one interactive picker session in the browser, never persisted
 * anywhere server-side (Ground Rule 6: the source PDF itself is discarded
 * the moment this handler returns; nothing here writes it to a bucket,
 * table, or log). Deliberately does NOT create a draft, a revision, or
 * touch the image pipeline -- an abandoned Phase A call leaves nothing
 * behind.
 *
 * Auth: identical editor/admin check to `createEditorialImportAction`
 * (app/(editor)/editorial/new/actions.ts) -- this workflow is staff-only
 * per CLAUDE.md's `app/(editor)/` folder convention. Route Handlers are not
 * wrapped by the `(editor)` layout's role guard (that guard only wraps
 * page.tsx's render tree, not colocated route.ts files), so this check is
 * not optional here.
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

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file." }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const parsed = pdfImportFileSchema.safeParse({ bytes });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid PDF file." },
      { status: 400 },
    );
  }

  const rendered = await renderPagePreviews(Buffer.from(parsed.data.bytes));
  if (!rendered.ok) {
    return NextResponse.json(
      { error: pdfImportErrorMessage(rendered.error) },
      { status: 400 },
    );
  }

  return NextResponse.json({
    pageCount: rendered.pageCount,
    pages: rendered.pages.map((page) => ({
      pageNumber: page.pageNumber,
      width: page.width,
      height: page.height,
      dataUrl: `data:image/png;base64,${page.bytes.toString("base64")}`,
    })),
  });
}
