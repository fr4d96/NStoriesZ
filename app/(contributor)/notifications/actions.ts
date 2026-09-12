"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { getErrorMessage } from "@/lib/errors";

export type MarkReadState = {
  error?: string;
  /**
   * ISO timestamp of the last SUCCESSFUL mark-read. Carries no information
   * the UI displays -- it exists so the value CHANGES on every success,
   * which is what lets the list fire its "recount" event once per action
   * rather than once per render. A bare `{}` success is indistinguishable
   * from the initial state.
   */
  markedAt?: string;
};

/**
 * Marks the caller's notifications read -- the ids in the form, or all of
 * them when none are given.
 *
 * No ownership check here, and none is missing: mark_my_notifications_read()
 * scopes its UPDATE to auth.uid() internally (20260911100000), so an id
 * belonging to someone else matches no row and changes nothing. That is
 * Engineering Rule 2 satisfied at the only layer that can enforce it -- this
 * action never re-derives ownership from the form, because it never trusts
 * the form for ownership in the first place.
 *
 * A Server Action rather than the client-side RPC the bell uses: this page
 * works without JavaScript, so "Mark read" is a real <form> submit and the
 * list re-renders from the database rather than from optimistic state.
 */
export async function markNotificationsReadAction(
  _prevState: MarkReadState,
  formData: FormData,
): Promise<MarkReadState> {
  const user = await getCurrentUser();
  if (!user) return { error: "You must be signed in." };

  // getAll, so one form can carry several ids; an empty list means "all",
  // which is exactly what the RPC's null default does.
  const ids = formData
    .getAll("notificationId")
    .filter((value): value is string => typeof value === "string" && !!value);

  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_my_notifications_read", {
    p_ids: ids.length > 0 ? ids : undefined,
  });
  if (error) {
    return { error: getErrorMessage(error, "Could not update notifications.") };
  }

  revalidatePath("/notifications");
  return { markedAt: new Date().toISOString() };
}
