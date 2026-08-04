"use server";

import { z } from "zod";
import { getCurrentUserRole, resolveStaffAccess } from "@/lib/auth/roles";
import {
  plainTextToBlocks,
  sanitizeHtmlToBlocks,
  type ImportError,
  type ImportReport,
} from "@/lib/story/content-import";
import type { StoryContentBlock } from "@/lib/validation/story";

/**
 * Pure conversion, no storyId param -- this action never touches any
 * story/revision row; it only parses/sanitizes text and returns the
 * canonical blocks + a report for the caller to preview before committing
 * anything (that commit happens separately, through the normal
 * saveRevisionFieldsAction/mutation-queue path once "Use this content" is
 * clicked). Independently re-checks editor/admin here -- this Server Action
 * is reachable regardless of which page rendered it, per the hard
 * constraint that no new editorial Server Action may rely on the
 * (editor) route group's layout guard alone.
 */

const inputSchema = z.object({
  format: z.enum(["plain", "html"]),
  content: z.string().min(1),
});

export type ImportActionResult =
  | { ok: true; blocks: StoryContentBlock[]; report: ImportReport }
  | { ok: false; error: ImportError | "unauthorized" | "invalid_input" };

export async function importStoryContentAction(
  input: unknown,
): Promise<ImportActionResult> {
  const role = await getCurrentUserRole();
  const access = resolveStaffAccess(role, ["editor", "admin"]);
  if (!access.ok) {
    return { ok: false, error: "unauthorized" };
  }

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "invalid_input" };
  }

  return parsed.data.format === "html"
    ? sanitizeHtmlToBlocks(parsed.data.content)
    : plainTextToBlocks(parsed.data.content);
}
