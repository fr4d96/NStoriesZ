import "server-only";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env.server";
import { rawStorageUpload } from "@/lib/story/raw-storage-http";
import {
  beginStoryMediaUpload,
  finalizeStoryMediaUpload,
  cancelPendingStoryMediaUpload,
  detachStoryMedia,
} from "@/lib/story/mutations";
import { processStoryMedia } from "@/lib/story/image-pipeline";
import { getStoryPreview } from "@/lib/story/contributor-queries";
import { MAX_IMAGES_PER_REVISION } from "@/lib/story/image-validation";
import {
  renderPagesAtFullQuality,
  type PdfPageRenderError,
} from "@/lib/story/pdf-import";

/**
 * Stage 2 of docs/pdf-canva-import-plan.md: takes a PDF and a caller-
 * supplied list of page numbers (Stage 4's page-picker UI will supply
 * these — not built yet), renders them at full/publish quality, and
 * attaches each one to a revision through the EXISTING, unmodified
 * `lib/story/image-pipeline.ts` path — exactly as if each were a manually
 * uploaded photo. Per Ground Rule 2 (the plan), this deliberately does not
 * invent a parallel image-upload path: every step below is the same
 * begin_/finalize_story_media_upload -> raw storage upload ->
 * processStoryMedia sequence
 * `app/(contributor)/stories/[id]/edit/upload/route.ts` already uses for a
 * manual upload, just driven in a loop over rendered PDF pages instead of
 * one `File` from a form.
 *
 * Not wired into any Server Action, Route Handler, or UI yet (Stage 4).
 * This module assumes it runs inside a request context that already has an
 * authenticated session (cookies) — same assumption every function in
 * `lib/story/mutations.ts` already makes.
 */

const PRIVATE_BUCKET = "story-images-private";

export type PdfPageAttachError =
  | PdfPageRenderError
  | "too_many_pages_selected"
  | "capacity_exceeded"
  | "unauthorized"
  | "attach_failed";

export type AttachedPdfPage = {
  pageNumber: number;
  mediaId: string;
  /** Position assigned by finalize_story_media_upload — reflects the exact
   * selection order this call attached pages in. */
  sortOrder: number;
  /** Hash of the processed derivative, once processing has completed. */
  sha256: string | null;
  /** True when this page's processed derivative matches another image
   * already on the same revision (itself included, if the selection
   * contained the same page twice) — a warning signal, not a hard block,
   * same convention as `components/story/image-upload-manager.tsx`'s
   * client-side same-story duplicate-image check. */
  isDuplicate: boolean;
};

export type PdfPageAttachResult =
  | { ok: true; attached: AttachedPdfPage[] }
  | { ok: false; error: PdfPageAttachError };

type PendingAttachment = {
  pageNumber: number;
  mediaId: string;
  state: "pending" | "attached";
};

/**
 * Renders `pageNumbers` from `bytes` at full/publish quality and attaches
 * each one, in order, to `revisionId` via the real image pipeline.
 *
 * Full rejection over partial/best-effort output (Ground Rule 3):
 *   - An over-the-12-image-per-revision selection (checked both up front,
 *     against the selection size alone, and against this revision's actual
 *     current attachment count) is rejected before anything is rendered or
 *     uploaded.
 *   - If a later step fails anyway (e.g. a concurrent attach won the
 *     capacity race after this call's own up-front check passed), every
 *     media reservation/attachment this call itself created is rolled back
 *     (cancelled if still pending, detached if already attached) before
 *     returning an error — never a partially-attached result.
 *
 * `alt_text`/`caption` are intentionally left unset on every attached
 * image (both null via `story_revision_media`'s own default) — Stage 4's
 * editor review step fills them in before submission is possible;
 * `story_revision_media_alt_text_required`'s check constraint is satisfied
 * because finalize_story_media_upload attaches with `decorative = true` as
 * a placeholder (see `20260806110100_fix_finalize_upload_alt_text_constraint.sql`),
 * the same placeholder every manual upload is born with. Submission itself
 * is still blocked by the existing `missingRequirements` gate on the
 * preview page until an editor supplies real alt text or leaves the image
 * decorative on purpose.
 */
export async function attachPdfPagesToRevision(params: {
  bytes: Buffer;
  pageNumbers: number[];
  storyId: string;
  revisionId: string;
  expectedVersion: number;
}): Promise<PdfPageAttachResult> {
  const { bytes, pageNumbers, storyId, revisionId } = params;

  if (
    pageNumbers.length === 0 ||
    pageNumbers.length > MAX_IMAGES_PER_REVISION
  ) {
    return { ok: false, error: "too_many_pages_selected" };
  }

  // Up-front capacity check against this revision's actual current state,
  // before rendering or uploading anything — the cheap, common-case way to
  // satisfy "reject cleanly, don't apply partially." begin_story_media_upload
  // (lib/story/mutations.ts) still independently re-enforces the same
  // 12-image cap transactionally under a lock on every call below, which is
  // what actually protects against a race against a concurrent attach; if
  // that happens anyway, the try/catch loop below rolls back everything
  // this call created rather than leaving a partial result.
  let existing;
  try {
    existing = await getStoryPreview(storyId);
  } catch {
    return { ok: false, error: "unauthorized" };
  }
  if (!existing) {
    return { ok: false, error: "unauthorized" };
  }
  if (existing.media.length + pageNumbers.length > MAX_IMAGES_PER_REVISION) {
    return { ok: false, error: "capacity_exceeded" };
  }

  const rendered = await renderPagesAtFullQuality(bytes, pageNumbers);
  if (!rendered.ok) return rendered;

  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return { ok: false, error: "unauthorized" };
  }

  const items: PendingAttachment[] = [];
  let version = params.expectedVersion;

  async function rollback(): Promise<void> {
    // Reverse order: undo the most recently created attachment first.
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      try {
        if (item.state === "pending") {
          await cancelPendingStoryMediaUpload(item.mediaId);
        } else {
          await detachStoryMedia(revisionId, version, item.mediaId);
          version += 1;
        }
      } catch {
        // Best-effort rollback — nothing further to do if even this fails;
        // the orphaned reservation/attachment is a pre-existing class of
        // problem this module doesn't newly introduce (same risk a failed
        // manual upload's cleanup already carries).
      }
    }
  }

  try {
    for (const page of rendered.pages) {
      let mediaId: string;
      let reservedPath: string;
      try {
        const reserved = await beginStoryMediaUpload(revisionId, "image/png");
        mediaId = reserved.media_id;
        reservedPath = reserved.reserved_path;
      } catch {
        await rollback();
        return { ok: false, error: "capacity_exceeded" };
      }
      items.push({ pageNumber: page.pageNumber, mediaId, state: "pending" });

      try {
        await rawStorageUpload(
          env.NEXT_PUBLIC_SUPABASE_URL,
          {
            apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
            bearerToken: session.access_token,
          },
          PRIVATE_BUCKET,
          reservedPath,
          page.bytes,
          "image/png",
          false,
        );
      } catch {
        await rollback();
        return { ok: false, error: "attach_failed" };
      }

      try {
        await finalizeStoryMediaUpload(mediaId, version);
        version += 1;
      } catch {
        await rollback();
        return { ok: false, error: "attach_failed" };
      }
      items[items.length - 1] = {
        ...items[items.length - 1],
        state: "attached",
      };

      // Processing failures are recorded server-side (moderation-visible
      // "failed" processingState) by processStoryMedia itself, same as the
      // manual-upload route handler — not fatal to this call, and not
      // rolled back: a "failed" attached image is a legitimate outcome an
      // editor can see and remove, same as any other upload that fails to
      // process.
      try {
        await processStoryMedia(mediaId);
      } catch {
        // Already recorded; nothing further to do here.
      }
    }
  } catch {
    await rollback();
    return { ok: false, error: "attach_failed" };
  }

  // Duplicate detection: compare sha256 of every image now on this revision
  // (pre-existing + just attached) — same signal
  // `components/story/image-upload-manager.tsx` computes client-side from
  // the same sha256 field, just computed here over the authoritative
  // post-attach state so it's available immediately rather than waiting for
  // the editor UI's own re-fetch.
  let final;
  try {
    final = await getStoryPreview(storyId);
  } catch {
    final = null;
  }
  const mediaList = final?.media ?? [];
  const hashCounts = new Map<string, number>();
  for (const m of mediaList) {
    if (m.sha256) hashCounts.set(m.sha256, (hashCounts.get(m.sha256) ?? 0) + 1);
  }
  const byId = new Map(mediaList.map((m) => [m.mediaId, m]));

  const attached: AttachedPdfPage[] = items.map((item) => {
    const row = byId.get(item.mediaId);
    const sha256 = row?.sha256 ?? null;
    return {
      pageNumber: item.pageNumber,
      mediaId: item.mediaId,
      sortOrder: row?.sortOrder ?? -1,
      sha256,
      isDuplicate: sha256 ? (hashCounts.get(sha256) ?? 0) > 1 : false,
    };
  });

  return { ok: true, attached };
}
