"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUserRole, resolveStaffAccess } from "@/lib/auth/roles";
import {
  confirmationMethods,
  identifiablePeopleStates,
} from "@/lib/validation/story";
import {
  markEditorialDraftAwaitingApproval,
  submitRevisionWithConsent,
  getCurrentTermsVersion,
} from "@/lib/story/mutations";
import { logEditorialAction } from "@/lib/story/moderation";

export type EditorialActionState = { error?: string; success?: string };

/**
 * Every action in this file independently re-checks editor/admin here --
 * Server Actions are reachable regardless of which page rendered them, so
 * the (editor) route group's layout guard alone is never sufficient
 * (hard constraint). The underlying RPCs re-check server-side too; this is
 * defense in depth, not a substitute.
 */
async function requireEditorOrAdmin(): Promise<string | null> {
  const role = await getCurrentUserRole();
  const access = resolveStaffAccess(role, ["editor", "admin"]);
  return access.ok ? null : "Only an editor or admin can perform this action.";
}

export async function markReadyForContributorReviewAction(
  storyId: string,
): Promise<EditorialActionState> {
  const authError = await requireEditorOrAdmin();
  if (authError) return { error: authError };

  const parsed = z.uuid().safeParse(storyId);
  if (!parsed.success) return { error: "Invalid story." };

  try {
    await markEditorialDraftAwaitingApproval(parsed.data);
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Could not mark this draft ready for contributor review.",
    };
  }

  revalidatePath(`/editorial/${parsed.data}/edit`);
  revalidatePath("/editorial");
  return { success: "Sent to the contributor for review." };
}

/**
 * Plain audit note, deliberately NON-authorizing -- logging evidence here
 * never confirms, grants, or substitutes for publication consent. Kept
 * visibly distinct in the UI from "Submit with offline confirmation" below,
 * which IS the real, audited consent path.
 */
export async function logEvidenceNoteAction(
  _prevState: EditorialActionState,
  formData: FormData,
): Promise<EditorialActionState> {
  const authError = await requireEditorOrAdmin();
  if (authError) return { error: authError };

  const storyId = z.uuid().safeParse(formData.get("storyId"));
  const revisionId = z.uuid().safeParse(formData.get("revisionId"));
  const summary = z
    .string()
    .trim()
    .min(1, "A note is required.")
    .max(4000)
    .safeParse(formData.get("summary"));
  if (!storyId.success || !revisionId.success) {
    return { error: "Invalid story or revision." };
  }
  if (!summary.success) {
    return { error: summary.error.issues[0]?.message ?? "Invalid note." };
  }

  try {
    await logEditorialAction({
      storyId: storyId.data,
      revisionId: revisionId.data,
      actionType: "evidence_note",
      summary: summary.data,
    });
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not log the note.",
    };
  }

  return { success: "Note logged (this does not grant or record consent)." };
}

const offlineConfirmationMethods = confirmationMethods.filter(
  (m) => m !== "account",
);

export type SubmitOfflineFormState = { error?: string; success?: string };

/**
 * The real offline-consent submission path for editorial imports --
 * distinct from logEvidenceNoteAction above. Fetches the current terms
 * version server-side immediately before submitting, minimizing the
 * staleness window before submit_revision_with_consent()'s own WHV01
 * mismatch check (the authoritative backstop either way).
 */
export async function submitWithOfflineConfirmationAction(
  _prevState: SubmitOfflineFormState,
  formData: FormData,
): Promise<SubmitOfflineFormState> {
  const authError = await requireEditorOrAdmin();
  if (authError) return { error: authError };

  const revisionId = z.uuid().safeParse(formData.get("revisionId"));
  const expectedVersion = z
    .number()
    .int()
    .safeParse(Number(formData.get("expectedVersion")));
  const confirmationMethod = z
    .enum(offlineConfirmationMethods)
    .safeParse(formData.get("confirmationMethod"));
  const identifiablePeopleState = z
    .enum(identifiablePeopleStates)
    .safeParse(formData.get("identifiablePeopleState") || "not_applicable");
  const imageRightsConfirmed = formData.get("imageRightsConfirmed") === "on";

  if (!revisionId.success || !expectedVersion.success) {
    return { error: "Invalid revision or version — reload and try again." };
  }
  if (!confirmationMethod.success) {
    return { error: "Choose how consent was confirmed." };
  }
  if (!identifiablePeopleState.success) {
    return { error: "Invalid identifiable-people state." };
  }

  try {
    const expectedTermsVersion = await getCurrentTermsVersion();
    await submitRevisionWithConsent({
      revisionId: revisionId.data,
      expectedVersion: expectedVersion.data,
      confirmationMethod: confirmationMethod.data,
      publicationConfirmed: true,
      expectedTermsVersion,
      imageRightsConfirmed,
      identifiablePeopleState: identifiablePeopleState.data,
      editorialAssistanceConfirmed: true,
    });
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Could not submit for moderation.",
    };
  }

  revalidatePath("/editorial");
  return { success: "Submitted for moderation." };
}
