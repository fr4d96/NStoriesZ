import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import type { NotificationRow } from "@/lib/notifications/notification-view";

/**
 * The most rows list_my_notifications() will return -- it clamps p_limit to
 * [1, 50] itself (20260911100000). The page asks for the ceiling; the bell
 * asks for 20.
 */
export const NOTIFICATIONS_PAGE_LIMIT = 50;

/**
 * Server-side reads for /notifications. Same contract as
 * lib/story/contributor-queries.ts: the caller is derived from the session
 * inside each function, never passed in -- the RPCs re-derive auth.uid()
 * anyway, and the getCurrentUser() check here only exists so a signed-out
 * caller gets a clean empty result instead of a raw Postgres error.
 *
 * The cast is the same one the bell makes and for the same reason:
 * `supabase gen types` marks every RETURNS TABLE column non-null, but
 * `read_at` and `reason` are genuinely nullable (null read_at IS unread).
 * See NotificationRow's own comment.
 */
export async function listMyNotifications(
  limit = NOTIFICATIONS_PAGE_LIMIT,
): Promise<NotificationRow[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_my_notifications", {
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as NotificationRow[];
}
