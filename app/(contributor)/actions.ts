"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import {
  profileUpdateSchema,
  createOwnContributorSchema,
} from "@/lib/validation/profile";

export type AccountFormState = {
  error?: string;
  success?: string;
};

export async function updateProfileAction(
  _prevState: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const user = await getCurrentUser();
  if (!user) {
    return { error: "You must be signed in." };
  }

  const parsed = profileUpdateSchema.safeParse({
    displayName: formData.get("displayName"),
    bio: formData.get("bio") ?? "",
    homeCountryCode: formData.get("homeCountryCode"),
    publicProfileEnabled: formData.get("publicProfileEnabled") === "on",
    publicSlug: formData.get("publicSlug") ?? "",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  // publicProfileEnabled requires a slug — enforced here (not just in the
  // DB) so the user gets an immediate, specific error.
  if (parsed.data.publicProfileEnabled && !parsed.data.publicSlug) {
    return {
      error: "Choose a public profile URL before making your profile public.",
    };
  }

  const supabase = await createClient();
  // Ownership is never client-supplied: .eq("id", user.id) targets only the
  // caller's own row, and RLS ("profiles: owner updates own profile") would
  // reject any attempt to target another user's row regardless.
  const { error } = await supabase
    .from("profiles")
    .update({
      display_name: parsed.data.displayName,
      bio: parsed.data.bio || null,
      home_country_code: parsed.data.homeCountryCode,
      public_profile_enabled: parsed.data.publicProfileEnabled,
      public_slug: parsed.data.publicSlug || null,
    })
    .eq("id", user.id);

  if (error) {
    // Most likely cause: public_slug already taken by another profile.
    if (error.code === "23505") {
      return { error: "That profile URL is already taken." };
    }
    return { error: "Could not update your profile. Please try again." };
  }

  revalidatePath("/account");
  return { success: "Profile updated." };
}

export async function createOwnContributorAction(
  _prevState: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const user = await getCurrentUser();
  if (!user) {
    return { error: "You must be signed in." };
  }

  const parsed = createOwnContributorSchema.safeParse({
    displayName: formData.get("displayName"),
    attributionType: formData.get("attributionType"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createClient();
  // linked_user_id and created_by are always set from the server-known
  // session, never from the form — matches the
  // "contributors: self-service create own contributor record" RLS policy,
  // which independently rejects anything else.
  const { error } = await supabase.from("contributors").insert({
    linked_user_id: user.id,
    created_by: user.id,
    display_name: parsed.data.displayName,
    attribution_type: parsed.data.attributionType,
  });

  if (error) {
    if (error.code === "23505") {
      return { error: "You already have a contributor identity." };
    }
    return {
      error: "Could not set up your contributor identity. Please try again.",
    };
  }

  revalidatePath("/account");
  return { success: "Contributor identity created." };
}

export async function updateOwnContributorAction(
  _prevState: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const user = await getCurrentUser();
  if (!user) {
    return { error: "You must be signed in." };
  }

  const parsed = createOwnContributorSchema.safeParse({
    displayName: formData.get("displayName"),
    attributionType: formData.get("attributionType"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createClient();
  // .eq("linked_user_id", user.id) plus RLS together prevent editing any
  // contributor record other than the caller's own linked one.
  const { error } = await supabase
    .from("contributors")
    .update({
      display_name: parsed.data.displayName,
      attribution_type: parsed.data.attributionType,
    })
    .eq("linked_user_id", user.id);

  if (error) {
    return {
      error: "Could not update your contributor identity. Please try again.",
    };
  }

  revalidatePath("/account");
  return { success: "Contributor identity updated." };
}
