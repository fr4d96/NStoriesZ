"use server";

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { createDraftSchema } from "@/lib/validation/story";
import { createSelfServiceDraftShell } from "@/lib/story/mutations";

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
    if (error instanceof Error && /contributor identity/i.test(error.message)) {
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
