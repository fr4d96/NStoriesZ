import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/get-current-user";

async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new Error("You must be signed in.");
  return user;
}

export type ContributorForEditorial = {
  id: string;
  displayName: string;
  publicStatus: string;
  attributionType: string;
  /**
   * Derived boolean only -- contributors.linked_user_id itself is selected
   * server-side (the existing "contributors: staff read all contributor
   * records" RLS policy already grants editor/admin full-row read) but is
   * dropped here before this object is ever returned, so it never reaches
   * any Client Component prop or the RSC payload. This is the
   * application-code equivalent of the story domain's "curated returns
   * table shape" convention, applied to a table that (unlike the story
   * domain) does have ordinary RLS grants.
   */
  isLinked: boolean;
};

/**
 * Editor/admin only (enforced by the underlying RLS policy, re-derived
 * server-side by Postgres regardless of what this function assumes) --
 * lists every contributor record with is_linked derived, never
 * linked_user_id itself.
 */
export async function listContributorsForEditorial(): Promise<
  ContributorForEditorial[]
> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contributors")
    .select("id, display_name, public_status, attribution_type, linked_user_id")
    .order("display_name");
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    displayName: row.display_name,
    publicStatus: row.public_status,
    attributionType: row.attribution_type,
    isLinked: row.linked_user_id !== null,
  }));
}

/**
 * Staff-prepared, unlinked contributor record for the founding-catalogue
 * import workflow -- linked_user_id is never set here (the RLS INSERT
 * policy "contributors: staff create unlinked contributor records"
 * independently requires it to be null and the caller to be editor/admin;
 * this is not the only enforcement).
 */
export async function createUnlinkedContributor(params: {
  displayName: string;
  attributionType: "real_name" | "display_name" | "pseudonym" | "anonymous";
}): Promise<{ id: string }> {
  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contributors")
    .insert({
      created_by: user.id,
      display_name: params.displayName,
      attribution_type: params.attributionType,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data;
}

export async function linkContributorToUser(
  contributorId: string,
  userId: string,
  note?: string,
) {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("link_contributor_to_user", {
    p_contributor_id: contributorId,
    p_user_id: userId,
    p_note: note,
  });
  if (error) throw error;
}

/**
 * supabase/migrations/20260804092400_restrict_contributor_linking_to_named_rpcs.sql#unlink_contributor_from_user()
 */
export async function unlinkContributorFromUser(
  contributorId: string,
  note?: string,
) {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("unlink_contributor_from_user", {
    p_contributor_id: contributorId,
    p_note: note,
  });
  if (error) throw error;
}

/**
 * supabase/migrations/20260804092100_submit_consent_requires_terms_version.sql#get_consent_terms_version() --
 * revision-scoped: what terms version (if any) was actually recorded
 * against this exact revision's consent grant.
 */
export async function getConsentTermsVersion(
  revisionId: string,
): Promise<string | null> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_consent_terms_version", {
    p_revision_id: revisionId,
  });
  if (error) throw error;
  return data;
}
