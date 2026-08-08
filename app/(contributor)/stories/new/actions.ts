"use server";

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { createDraftSchema } from "@/lib/validation/story";
import { createSelfServiceDraftShell } from "@/lib/story/mutations";
import { getErrorMessage } from "@/lib/errors";

export type NewStoryFormState = {
  error?: string;
};

export async function createDraftAction(
  _prevState: NewStoryFormState,
  formData: FormData,
): Promise<NewStoryFormState> {
  const user = await getCurrentUser();
  if (!user) {
    return { error: "You must be signed in." };
  }

  const parsed = createDraftSchema.safeParse({
    title: formData.get("title"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  let result: { story_id: string; revision_id: string } | null;
  try {
    result = await createSelfServiceDraftShell(parsed.data.title);
  } catch (error) {
    // getErrorMessage(), not `error instanceof Error` -- the Supabase
    // client can reject an RPC call with a plain PostgrestError-shaped
    // object ({ code, details, hint, message }) that fails that check
    // (confirmed live: create_self_service_draft()'s raised "You must set
    // up your contributor identity..." exception never matched the old
    // check, so every dev-account without a contributor row just saw the
    // generic fallback instead of the actionable message).
    if (/contributor identity/i.test(getErrorMessage(error, ""))) {
      return {
        error:
          "Set up your contributor identity on the Account page before starting a story.",
      };
    }
    return { error: "Could not start a new story. Please try again." };
  }

  if (!result?.story_id) {
    return { error: "Could not start a new story. Please try again." };
  }

  redirect(`/stories/${result.story_id}/edit`);
}
