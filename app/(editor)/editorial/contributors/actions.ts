"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUserRole, resolveStaffAccess } from "@/lib/auth/roles";
import {
  createUnlinkedContributor,
  linkContributorToUser,
  unlinkContributorFromUser,
} from "@/lib/story/editorial-queries";

export type ContributorsFormState = { error?: string; success?: string };

async function requireEditorOrAdmin(): Promise<string | null> {
  const role = await getCurrentUserRole();
  const access = resolveStaffAccess(role, ["editor", "admin"]);
  return access.ok
    ? null
    : "Only an editor or admin can manage contributor records.";
}

const attributionTypeSchema = z.enum([
  "real_name",
  "display_name",
  "pseudonym",
  "anonymous",
]);

export async function createUnlinkedContributorAction(
  _prevState: ContributorsFormState,
  formData: FormData,
): Promise<ContributorsFormState> {
  const authError = await requireEditorOrAdmin();
  if (authError) return { error: authError };

  const displayName = z
    .string()
    .trim()
    .min(1, "Name is required.")
    .max(120)
    .safeParse(formData.get("displayName"));
  const attributionType = attributionTypeSchema.safeParse(
    formData.get("attributionType"),
  );
  if (!displayName.success) {
    return { error: displayName.error.issues[0]?.message ?? "Invalid name." };
  }
  if (!attributionType.success) {
    return { error: "Invalid attribution type." };
  }

  try {
    await createUnlinkedContributor({
      displayName: displayName.data,
      attributionType: attributionType.data,
    });
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Could not create the contributor record.",
    };
  }

  revalidatePath("/editorial/contributors");
  return { success: "Contributor record created." };
}

export async function linkContributorAction(
  _prevState: ContributorsFormState,
  formData: FormData,
): Promise<ContributorsFormState> {
  const authError = await requireEditorOrAdmin();
  if (authError) return { error: authError };

  const contributorId = z.uuid().safeParse(formData.get("contributorId"));
  const userId = z.uuid().safeParse(formData.get("userId"));
  if (!contributorId.success || !userId.success) {
    return { error: "Invalid contributor or account id." };
  }
  const note = String(formData.get("note") ?? "").trim() || undefined;

  try {
    await linkContributorToUser(contributorId.data, userId.data, note);
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Could not link the account.",
    };
  }

  revalidatePath("/editorial/contributors");
  return { success: "Contributor linked." };
}

export async function unlinkContributorAction(
  _prevState: ContributorsFormState,
  formData: FormData,
): Promise<ContributorsFormState> {
  const authError = await requireEditorOrAdmin();
  if (authError) return { error: authError };

  const contributorId = z.uuid().safeParse(formData.get("contributorId"));
  if (!contributorId.success) {
    return { error: "Invalid contributor id." };
  }
  const note = String(formData.get("note") ?? "").trim() || undefined;

  try {
    await unlinkContributorFromUser(contributorId.data, note);
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Could not unlink the account.",
    };
  }

  revalidatePath("/editorial/contributors");
  return { success: "Contributor unlinked." };
}
