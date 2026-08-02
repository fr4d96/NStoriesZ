import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/get-current-user";

// Every function here derives the caller from the session internally — none
// accept a userId parameter (the RPCs themselves also re-derive auth.uid()
// server-side; getCurrentUser() here is only so a signed-out caller gets a
// clean empty result instead of a raw Postgres auth error).

export async function listMyStories() {
  const user = await getCurrentUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_my_stories");
  if (error) throw error;
  return data ?? [];
}

export async function getEditableStoryWithDraft(storyId: string) {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_my_story_with_draft", {
    p_story_id: storyId,
  });
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function getCurrentConsentState(storyId: string) {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("current_consent_state", {
    p_story_id: storyId,
  });
  if (error) throw error;
  return data ?? null;
}
