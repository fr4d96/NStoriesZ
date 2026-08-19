"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import {
  submitRevisionSchema,
  identifiablePeopleStates,
} from "@/lib/validation/story";
import {
  submitRevisionWithConsent,
  getCurrentTermsVersion,
  requestEditorialChanges,
  declineEditorialPublication,
} from "@/lib/story/mutations";
import { getErrorMessage } from "@/lib/errors";

export type ConsentActionState = { error?: string; success?: string };

async function requireSignedIn(): Promise<string | null> {
  const user = await getCurrentUser();
  return user ? null : "You must be signed in.";
}

/**
 * Contributor/owner "account" consent-at-submission. Fetches the current
 * terms version server-side immediately before submitting -- minimizing the
 * staleness window before submit_revision_with_consent()'s own WHV01
 * mismatch check (the authoritative backstop either way).
 */
export async function submitOwnConsentAction(
  _prevState: ConsentActionState,
  formData: FormData,
): Promise<ConsentActionState> {
  const authError = await requireSignedIn();
  if (authError) return { error: authError };

  const parsed = submitRevisionSchema.safeParse({
    revisionId: formData.get("revisionId"),
    expectedVersion: Number(formData.get("expectedVersion")),
    confirmationMethod: "account",
    publicationConfirmed: formData.get("publicationConfirmed") === "on",
    // Placeholder -- overwritten with a freshly-fetched value below. Present
    // here only so the schema's required field doesn't reject the form
    // payload before we've had a chance to fetch the real one.
    expectedTermsVersion: "pending",
    imageRightsConfirmed: formData.get("imageRightsConfirmed") === "on",
    identifiablePeopleState: identifiablePeopleStates.includes(
      formData.get("identifiablePeopleState") as never,
    )
      ? (formData.get(
          "identifiablePeopleState",
        ) as (typeof identifiablePeopleStates)[number])
      : "not_applicable",
    editorialAssistanceConfirmed:
      formData.get("editorialAssistanceConfirmed") === "on",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid submission." };
  }

  try {
    const expectedTermsVersion = await getCurrentTermsVersion();
    await submitRevisionWithConsent({ ...parsed.data, expectedTermsVersion });
  } catch (error) {
    return {
      error: getErrorMessage(error, "Could not submit this story for review."),
    };
  }

  revalidatePath(`/stories/${formData.get("storyId")}/preview`);
  revalidatePath("/my-stories");
  // A submitted (or contributor-approved) story is no longer something to
  // keep looking at on this page -- it's back in the queue. Land the
  // contributor where they can see it move: My Stories, which already shows
  // a status badge for `pending_review`/`awaiting_contributor_approval`
  // (components/story/status-badge.tsx). redirect() throws internally, so
  // this never returns a state the form could render -- the `toast` query
  // param carries the confirmation across the redirect instead
  // (app/(contributor)/my-stories/submission-toast.tsx picks it up).
  redirect("/my-stories?toast=submitted");
}

export async function requestEditorialChangesAction(
  _prevState: ConsentActionState,
  formData: FormData,
): Promise<ConsentActionState> {
  const authError = await requireSignedIn();
  if (authError) return { error: authError };

  const storyId = z.uuid().safeParse(formData.get("storyId"));
  const note = z
    .string()
    .trim()
    .min(1, "Describe what needs to change.")
    .max(4000)
    .safeParse(formData.get("note"));
  if (!storyId.success) return { error: "Invalid story." };
  if (!note.success) {
    return { error: note.error.issues[0]?.message ?? "Invalid note." };
  }

  try {
    await requestEditorialChanges(storyId.data, note.data);
  } catch (error) {
    return {
      error: getErrorMessage(error, "Could not request changes."),
    };
  }

  revalidatePath(`/stories/${storyId.data}/preview`);
  revalidatePath("/my-stories");
  return { success: "Requested changes from the editor." };
}

export async function declineEditorialPublicationAction(
  _prevState: ConsentActionState,
  formData: FormData,
): Promise<ConsentActionState> {
  const authError = await requireSignedIn();
  if (authError) return { error: authError };

  const storyId = z.uuid().safeParse(formData.get("storyId"));
  const note = z
    .string()
    .trim()
    .max(4000)
    .safeParse(formData.get("note") ?? "");
  if (!storyId.success) return { error: "Invalid story." };
  if (!note.success) return { error: "Invalid note." };

  try {
    await declineEditorialPublication(storyId.data, note.data);
  } catch (error) {
    return {
      error: getErrorMessage(error, "Could not decline."),
    };
  }

  revalidatePath(`/stories/${storyId.data}/preview`);
  revalidatePath("/my-stories");
  return { success: "Declined." };
}
