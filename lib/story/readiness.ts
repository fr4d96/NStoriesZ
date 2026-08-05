import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import type { Database } from "@/types/database";

async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new Error("You must be signed in.");
  return user;
}

export type ReadinessQueueParams = {
  sourceKind?: string;
  lifecycleStatus?: string;
  limit?: number;
  offset?: number;
};

export type ReadinessQueueRow =
  Database["public"]["Functions"]["get_content_readiness_queue"]["Returns"][number];

export async function getContentReadinessQueue(
  params: ReadinessQueueParams = {},
): Promise<ReadinessQueueRow[]> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_content_readiness_queue", {
    p_source_kind: params.sourceKind,
    p_lifecycle_status: params.lifecycleStatus,
    p_limit: params.limit,
    p_offset: params.offset,
  });
  if (error) throw error;
  return data ?? [];
}

export type OperationalMetrics =
  Database["public"]["Functions"]["get_operational_metrics"]["Returns"][number];

export async function getOperationalMetrics(): Promise<OperationalMetrics | null> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_operational_metrics");
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function recordStoryLaunchVerification(params: {
  storyId: string;
  desktopChecked: boolean;
  mobileChecked: boolean;
  note?: string;
}): Promise<string> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "record_story_launch_verification",
    {
      p_story_id: params.storyId,
      p_desktop_checked: params.desktopChecked,
      p_mobile_checked: params.mobileChecked,
      p_note: params.note || undefined,
    },
  );
  if (error) throw error;
  return data as string;
}
