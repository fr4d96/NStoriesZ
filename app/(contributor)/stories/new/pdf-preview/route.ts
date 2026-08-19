import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { pdfImportFileSchema } from "@/lib/validation/pdf-import";
import { renderPagePreviews } from "@/lib/story/pdf-import";
import { pdfImportErrorMessage } from "@/lib/story/pdf-import-messages";

// Node runtime (not Edge): pdfjs-dist/@napi-rs/canvas (lib/story/pdf-import.ts)
// need real Node APIs, same reasoning as
// app/(editor)/editorial/new/pdf-preview/route.ts's own runtime pin.
export const runtime = "nodejs";

/**
 * Contributor-facing twin of app/(editor)/editorial/new/pdf-preview/route.ts
 * — same Phase A (upload -> render page thumbnails, nothing persisted)
 * behavior, gated on "signed in" rather than "editor/admin", so a
 * contributor drafting their own story gets the same PDF/Canva-export import
 * option editors already have for editorial imports.
 *
 * POST /stories/new/pdf-preview -- multipart form field: `file` (the raw
 * PDF). Renders every page (up to MAX_PDF_IMPORT_PAGES) to a preview PNG and
 * returns them as base64 data URLs -- never written to a bucket, table, or
 * log (Ground Rule 6, docs/pdf-canva-import-plan.md).
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
