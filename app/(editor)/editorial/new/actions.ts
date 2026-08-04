"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUserRole, resolveStaffAccess } from "@/lib/auth/roles";
import { createDraftSchema } from "@/lib/validation/story";
import { createEditorialImportDraftShell } from "@/lib/story/mutations";
import { createUnlinkedContributor } from "@/lib/story/editorial-queries";

export type NewImportFormState = { error?: string };

const attributionTypeSchema = z.enum([
  "real_name",
  "display_name",
  "pseudonym",
  "anonymous",
]);

/**
 * Handles both "pick an existing contributor" and "create a new unlinked
 * contributor" in one submit -- every editorial Server Action independently
 * re-checks editor/admin here, rather than relying on the (editor) route
 * group's layout guard alone (Server Actions are reachable regardless of
 * which page rendered them; the underlying RPCs re-check server-side too,
 * this is defense in depth, not the only gate).
 */
export async function createEditorialImportAction(
  _prevState: NewImportFormState,
  formData: FormData,
): Promise<NewImportFormState> {
  const role = await getCurrentUserRole();
  const access = resolveStaffAccess(role, ["editor", "admin"]);
  if (!access.ok) {
    return { error: "Only an editor or admin can start an editorial import." };
  }

  const titleParsed = createDraftSchema.safeParse({
    title: formData.get("title"),
  });
  if (!titleParsed.success) {
    return { error: titleParsed.error.issues[0]?.message ?? "Invalid title." };
  }

  const mode = formData.get("contributorMode");
  let contributorId: string;

  if (mode === "new") {
    const displayName = z
      .string()
      .trim()
      .min(1, "Contributor name is required.")
      .max(120)
      .safeParse(formData.get("newContributorDisplayName"));
    const attributionType = attributionTypeSchema.safeParse(
      formData.get("newContributorAttributionType"),
    );
    if (!displayName.success) {
      return { error: displayName.error.issues[0]?.message ?? "Invalid name." };
    }
    if (!attributionType.success) {
      return { error: "Invalid attribution type." };
    }
    try {
      const created = await createUnlinkedContributor({
        displayName: displayName.data,
        attributionType: attributionType.data,
      });
      contributorId = created.id;
    } catch (error) {
      return {
        error:
          error instanceof Error
            ? error.message
            : "Could not create the contributor record.",
      };
    }
  } else {
    const existing = z.uuid().safeParse(formData.get("existingContributorId"));
    if (!existing.success) {
      return { error: "Choose a contributor." };
    }
    contributorId = existing.data;
  }

  let storyId: string;
  try {
    const created = await createEditorialImportDraftShell(
      contributorId,
      titleParsed.data.title,
    );
    if (!created) {
      return { error: "Could not create the import draft." };
    }
    storyId = created.story_id;
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Could not create the import draft.",
    };
  }

  redirect(`/editorial/${storyId}/edit`);
}
