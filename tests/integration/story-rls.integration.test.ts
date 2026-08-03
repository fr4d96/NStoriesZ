/**
 * RLS / lifecycle integration suite for the story domain. Runs against the
 * REAL linked hosted Supabase dev project — not mocked, not local (Docker is
 * unavailable in this repo's environment; see docs/architecture.md).
 *
 * NOT part of `npm run verify` / default `vitest run` — run explicitly via
 * `npm run test:rls`. Requires a one-time `.env.test.local` setup (a fixed
 * pool of 5 pre-confirmed accounts: owner, other, editor, moderator, admin —
 * see docs/architecture.md "RLS integration test setup" for exactly why a
 * fixed pool is used instead of signing up fresh accounts per run).
 *
 * Fail-closed by design: every required env var must be set, the URL must
 * contain the configured project ref, and SUPABASE_RLS_TEST_CONFIRM must
 * exactly equal a string that embeds the ref — see assertSafeToRun() below.
 * Runs serially (no test.concurrent) since several scenarios deliberately
 * share the fixed accounts and the one-active-draft-per-story lock.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

function assertSafeToRun() {
  const required = [
    "SUPABASE_RLS_TEST_URL",
    "SUPABASE_RLS_TEST_PROJECT_REF",
    "SUPABASE_RLS_TEST_PUBLISHABLE_KEY",
    "SUPABASE_RLS_TEST_CONFIRM",
    "SUPABASE_RLS_TEST_OWNER_EMAIL",
    "SUPABASE_RLS_TEST_OWNER_PASSWORD",
    "SUPABASE_RLS_TEST_OTHER_EMAIL",
    "SUPABASE_RLS_TEST_OTHER_PASSWORD",
    "SUPABASE_RLS_TEST_EDITOR_EMAIL",
    "SUPABASE_RLS_TEST_EDITOR_PASSWORD",
    "SUPABASE_RLS_TEST_MODERATOR_EMAIL",
    "SUPABASE_RLS_TEST_MODERATOR_PASSWORD",
    "SUPABASE_RLS_TEST_ADMIN_EMAIL",
    "SUPABASE_RLS_TEST_ADMIN_PASSWORD",
  ];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `RLS integration suite refuses to run: missing env vars: ${missing.join(", ")}. ` +
        `See .env.test.local / docs/architecture.md "RLS integration test setup".`,
    );
  }

  const url = process.env.SUPABASE_RLS_TEST_URL!;
  const ref = process.env.SUPABASE_RLS_TEST_PROJECT_REF!;
  if (!new URL(url).host.includes(ref)) {
    throw new Error(
      `RLS integration suite refuses to run: SUPABASE_RLS_TEST_URL (${url}) does not contain SUPABASE_RLS_TEST_PROJECT_REF (${ref}).`,
    );
  }

  const expectedConfirm = `i-confirm-${ref}-is-a-disposable-dev-project`;
  if (process.env.SUPABASE_RLS_TEST_CONFIRM !== expectedConfirm) {
    throw new Error(
      `RLS integration suite refuses to run: SUPABASE_RLS_TEST_CONFIRM must exactly equal "${expectedConfirm}".`,
    );
  }

  console.log(`[rls-suite] target host: ${new URL(url).host} (ref ${ref})`);
}

assertSafeToRun();

const url = process.env.SUPABASE_RLS_TEST_URL!;
const key = process.env.SUPABASE_RLS_TEST_PUBLISHABLE_KEY!;

function anonClient(): SupabaseClient<Database> {
  return createClient<Database>(url, key);
}

async function signedInClient(email: string, password: string) {
  const client = anonClient();
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.user) {
    throw new Error(`Could not sign in as ${email}: ${error?.message}`);
  }
  return { client, userId: data.user.id };
}

const runId = Math.random().toString(36).slice(2, 10);
const slug = (label: string) => `rls-test-${runId}-${label}`;

let owner: { client: SupabaseClient<Database>; userId: string };
let other: { client: SupabaseClient<Database>; userId: string };
let editor: { client: SupabaseClient<Database>; userId: string };
let moderator: { client: SupabaseClient<Database>; userId: string };
let admin: { client: SupabaseClient<Database>; userId: string };
let anon: SupabaseClient<Database>;
let ownerContributorId: string;

/**
 * Approves a submitted revision through the Prompt 4 publication-attempt
 * flow — moderate_revision({decision:"approve"}) no longer exists (it now
 * raises, directing callers here). None of the revisions in this suite
 * attach media, so there is nothing to copy-prepare before finalizing.
 */
async function approveRevision(
  moderatorClient: SupabaseClient<Database>,
  revisionId: string,
) {
  const { data: attemptId, error: beginError } = await moderatorClient.rpc(
    "begin_story_publication_attempt",
    { p_revision_id: revisionId },
  );
  if (beginError || !attemptId) {
    return { error: beginError ?? new Error("no attempt id returned") };
  }
  const { error } = await moderatorClient.rpc("finalize_story_publication", {
    p_revision_id: revisionId,
    p_approval_attempt_id: attemptId,
  });
  return { error };
}

beforeAll(async () => {
  owner = await signedInClient(
    process.env.SUPABASE_RLS_TEST_OWNER_EMAIL!,
    process.env.SUPABASE_RLS_TEST_OWNER_PASSWORD!,
  );
  other = await signedInClient(
    process.env.SUPABASE_RLS_TEST_OTHER_EMAIL!,
    process.env.SUPABASE_RLS_TEST_OTHER_PASSWORD!,
  );
  editor = await signedInClient(
    process.env.SUPABASE_RLS_TEST_EDITOR_EMAIL!,
    process.env.SUPABASE_RLS_TEST_EDITOR_PASSWORD!,
  );
  moderator = await signedInClient(
    process.env.SUPABASE_RLS_TEST_MODERATOR_EMAIL!,
    process.env.SUPABASE_RLS_TEST_MODERATOR_PASSWORD!,
  );
  admin = await signedInClient(
    process.env.SUPABASE_RLS_TEST_ADMIN_EMAIL!,
    process.env.SUPABASE_RLS_TEST_ADMIN_PASSWORD!,
  );
  anon = anonClient();

  // Idempotent: the owner account's contributor identity persists across runs.
  const { data: existing } = await owner.client
    .from("contributors")
    .select("id")
    .eq("linked_user_id", owner.userId)
    .maybeSingle();
  if (existing) {
    ownerContributorId = existing.id;
  } else {
    const { data, error } = await owner.client
      .from("contributors")
      .insert({
        linked_user_id: owner.userId,
        created_by: owner.userId,
        display_name: "RLS Test Owner",
        attribution_type: "display_name",
      })
      .select("id")
      .single();
    if (error || !data)
      throw new Error(`Could not set up owner contributor: ${error?.message}`);
    ownerContributorId = data.id;
  }
}, 30000);

afterAll(async () => {
  await Promise.all(
    [owner, other, editor, moderator, admin].map(({ client }) =>
      client.auth.signOut(),
    ),
  );
});

describe("direct table access is denied for everyone", () => {
  // No table in the story domain grants direct PostgREST access at all (see
  // docs/architecture.md) — a direct query is rejected at the privilege-grant
  // level (42501), not merely RLS-filtered to an empty result.
  it("anon reading stories directly is rejected", async () => {
    const { data, error } = await anon.from("stories").select("*");
    expect(error?.code).toBe("42501");
    expect(data).toBeNull();
  });

  it("an authenticated owner reading stories directly is rejected too", async () => {
    const { data, error } = await owner.client.from("stories").select("*");
    expect(error?.code).toBe("42501");
    expect(data).toBeNull();
  });

  it("an authenticated admin reading stories directly is rejected too", async () => {
    const { data, error } = await admin.client.from("stories").select("*");
    expect(error?.code).toBe("42501");
    expect(data).toBeNull();
  });

  it("a direct insert into stories is rejected", async () => {
    const { error } = await owner.client.from("stories").insert({
      contributor_id: ownerContributorId,
      source_kind: "self_submitted",
      slug: slug("direct-insert"),
    });
    expect(error).not.toBeNull();
  });
});

describe("internal helpers are unreachable via the API", () => {
  it("_is_story_owner cannot be called", async () => {
    // Present in generated types (introspection sees every function
    // regardless of grants) but unreachable over the API — no EXECUTE grant
    // exists for anon/authenticated on any `_`-prefixed helper.
    const { error } = await owner.client.rpc("_is_story_owner", {
      p_story_id: "11111111-1111-4111-8111-111111111111",
    });
    expect(error).not.toBeNull();
  });

  it("_revision_is_editable cannot be called", async () => {
    const { error } = await admin.client.rpc("_revision_is_editable", {
      p_revision_id: "11111111-1111-4111-8111-111111111111",
    });
    expect(error).not.toBeNull();
  });
});

describe("the image-processing/promotion trust boundary is service_role only", () => {
  // promote_story_media (Prompt 3) was dropped in Prompt 4 — its role is
  // absorbed into finalize_story_publication(). record_processed_story_media
  // and the copy-attempt functions are its Prompt 4 successors: none of them
  // are reachable via the regular `authenticated` client, no matter the
  // caller's role — only service_role (never used by any interactive-user
  // client) is granted execute.
  it("record_processed_story_media cannot be called by an admin over the regular client", async () => {
    const { error } = await admin.client.rpc("record_processed_story_media", {
      p_media_id: "11111111-1111-4111-8111-111111111111",
      p_processed_private_storage_path: "x",
      p_source_mime_type: "image/webp",
      p_source_width: 1,
      p_source_height: 1,
      p_processed_mime_type: "image/webp",
      p_processed_file_size_bytes: 1,
      p_processed_width: 1,
      p_processed_height: 1,
      p_sha256: "0".repeat(64),
    });
    expect(error).not.toBeNull();
  });

  it("begin_story_media_copy_attempt cannot be called by an admin over the regular client", async () => {
    const { error } = await admin.client.rpc("begin_story_media_copy_attempt", {
      p_media_id: "11111111-1111-4111-8111-111111111111",
      p_approval_attempt_id: "11111111-1111-4111-8111-111111111111",
    });
    expect(error).not.toBeNull();
  });

  it("maintenance_cancel_abandoned_reservation cannot be called by an admin over the regular client", async () => {
    const { error } = await admin.client.rpc(
      "maintenance_cancel_abandoned_reservation",
      { p_media_id: "11111111-1111-4111-8111-111111111111" },
    );
    expect(error).not.toBeNull();
  });
});

describe("self-service first-publication lifecycle", () => {
  let storyId: string;
  let revisionId: string;
  let version: number;
  let storySlug: string;

  it("owner creates a self-service draft", async () => {
    const { data, error } = await owner.client.rpc(
      "create_self_service_draft",
      {
        p_title: slug("first-pub"),
        p_content_json: [{ type: "paragraph", text: "Hello world." }],
      },
    );
    expect(error).toBeNull();
    expect(data?.[0]?.story_id).toBeTruthy();
    storyId = data![0].story_id;
    revisionId = data![0].revision_id;
  });

  it("another user cannot read or edit the private draft", async () => {
    const { data, error: readError } = await other.client.rpc(
      "get_my_story_with_draft",
      {
        p_story_id: storyId,
      },
    );
    expect(data).toBeNull();
    expect(readError).not.toBeNull();
    const { error } = await other.client.rpc("save_revision_draft", {
      p_revision_id: revisionId,
      p_expected_version: 1,
      p_title: "hijacked",
    });
    expect(error).not.toBeNull();
  });

  it("owner reads their own draft and gets the current version", async () => {
    const { data, error } = await owner.client.rpc("get_my_story_with_draft", {
      p_story_id: storyId,
    });
    expect(error).toBeNull();
    expect(data?.[0]?.story_id).toBe(storyId);
    version = data![0].version;
    // The actual slug (title + a random suffix from _generate_story_slug)
    // is not the same string as the title passed to create_self_service_draft.
    storySlug = data![0].slug;
  });

  it("owner cannot submit without publication_confirmed", async () => {
    const { error } = await owner.client.rpc("submit_revision_with_consent", {
      p_revision_id: revisionId,
      p_expected_version: version,
      p_confirmation_method: "account",
      p_publication_confirmed: false,
    });
    expect(error).not.toBeNull();
  });

  it("an editor cannot record offline consent for a self-service story", async () => {
    const { error } = await editor.client.rpc("submit_revision_with_consent", {
      p_revision_id: revisionId,
      p_expected_version: version,
      p_confirmation_method: "email",
      p_publication_confirmed: true,
    });
    expect(error).not.toBeNull();
  });

  it("owner submits with account consent", async () => {
    const { error } = await owner.client.rpc("submit_revision_with_consent", {
      p_revision_id: revisionId,
      p_expected_version: version,
      p_confirmation_method: "account",
      p_publication_confirmed: true,
    });
    expect(error).toBeNull();
  });

  it("owner (author) cannot moderate their own submission", async () => {
    const { data } = await owner.client.rpc("get_my_story_with_draft", {
      p_story_id: storyId,
    });
    const currentVersion = data![0].version;
    const { error } = await owner.client.rpc("moderate_revision", {
      p_revision_id: revisionId,
      p_expected_version: currentVersion,
      p_decision: "approve",
    });
    expect(error).not.toBeNull();
  });

  it("an editor cannot moderate either", async () => {
    const { data } = await owner.client.rpc("get_my_story_with_draft", {
      p_story_id: storyId,
    });
    const currentVersion = data![0].version;
    const { error } = await editor.client.rpc("moderate_revision", {
      p_revision_id: revisionId,
      p_expected_version: currentVersion,
      p_decision: "approve",
    });
    expect(error).not.toBeNull();
  });

  it("moderator approves — safe-shaped public read appears with no sensitive keys", async () => {
    const { error } = await approveRevision(moderator.client, revisionId);
    expect(error).toBeNull();

    const { data: story, error: readError } = await anon
      .from("stories")
      .select("slug")
      .eq("id", storyId);
    expect(readError?.code).toBe("42501"); // still no direct table access, even for a published row
    expect(story).toBeNull();

    const { data: pub, error: pubError } = await anon.rpc(
      "get_published_story",
      {
        p_slug: storySlug,
      },
    );
    expect(pubError).toBeNull();
    expect(pub?.[0]?.title).toBe(slug("first-pub"));
    const keys = Object.keys(pub![0]);
    for (const forbidden of [
      "owner_user_id",
      "created_by",
      "assigned_editor_id",
      "editor_note",
      "internal_note",
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("a moderator cannot rewrite the approved content directly", async () => {
    const { error } = await moderator.client
      .from("story_revisions")
      .update({ title: "rewritten by moderator" })
      .eq("id", revisionId);
    expect(error).not.toBeNull();
  });
});

describe("published-replacement lifecycle preserves the current publication", () => {
  let storyId: string;
  let firstRevisionId: string;
  let replacementRevisionId: string;

  beforeAll(async () => {
    const { data } = await owner.client.rpc("create_self_service_draft", {
      p_title: slug("replacement-base"),
      p_content_json: [{ type: "paragraph", text: "Original." }],
    });
    storyId = data![0].story_id;
    firstRevisionId = data![0].revision_id;
    await owner.client.rpc("submit_revision_with_consent", {
      p_revision_id: firstRevisionId,
      p_expected_version: 1,
      p_confirmation_method: "account",
      p_publication_confirmed: true,
    });
    await approveRevision(moderator.client, firstRevisionId);
  }, 30000);

  it("owner can start a replacement while the story stays published", async () => {
    const { data: story } = await owner.client.rpc("get_my_story_with_draft", {
      p_story_id: storyId,
    });
    expect(story?.[0]?.lifecycle_status).toBe("published");

    const { data: newRevisionId, error } = await owner.client.rpc(
      "create_next_draft_revision",
      {
        p_story_id: storyId,
      },
    );
    expect(error).toBeNull();
    replacementRevisionId = newRevisionId as unknown as string;

    const { data: storyAfter } = await owner.client.rpc(
      "get_my_story_with_draft",
      {
        p_story_id: storyId,
      },
    );
    expect(storyAfter?.[0]?.lifecycle_status).toBe("published");
  });

  it("submitting the replacement does not change what the public sees", async () => {
    const { data: storyBefore } = await owner.client.rpc(
      "get_my_story_with_draft",
      {
        p_story_id: storyId,
      },
    );
    await owner.client.rpc("save_revision_draft", {
      p_revision_id: replacementRevisionId,
      p_expected_version: storyBefore![0].version,
      p_title: slug("replacement-base") + "-v2",
      p_content_json: [{ type: "paragraph", text: "Updated." }],
    });
    const { data: storyAfterSave } = await owner.client.rpc(
      "get_my_story_with_draft",
      {
        p_story_id: storyId,
      },
    );
    await owner.client.rpc("submit_revision_with_consent", {
      p_revision_id: replacementRevisionId,
      p_expected_version: storyAfterSave![0].version,
      p_confirmation_method: "account",
      p_publication_confirmed: true,
    });

    const { data: pub } = await anon.rpc("get_published_story", {
      p_slug: storyBefore![0].slug,
    });
    expect(pub?.[0]?.title).toBe(slug("replacement-base"));
  });

  it("stale consent from the withdrawn/old revision does not authorize a different revision", async () => {
    // firstRevisionId is already approved/superseded, not the live submitted
    // one — begin_story_publication_attempt() rejects it outright since it
    // requires revision_status = 'submitted', preserving the same invariant
    // moderate_revision() used to enforce directly.
    const { error } = await moderator.client.rpc(
      "begin_story_publication_attempt",
      { p_revision_id: firstRevisionId },
    );
    expect(error).not.toBeNull();
  });
});

describe("withdrawal freezes the replacement without touching the publication", () => {
  it("withdraw before moderation acts: story stays published, revision terminalizes to withdrawn, and a fresh draft can be started", async () => {
    const { data: created } = await owner.client.rpc(
      "create_self_service_draft",
      {
        p_title: slug("withdraw-base"),
        p_content_json: [{ type: "paragraph", text: "Base." }],
      },
    );
    const storyId = created![0].story_id;
    const firstRevisionId = created![0].revision_id;
    await owner.client.rpc("submit_revision_with_consent", {
      p_revision_id: firstRevisionId,
      p_expected_version: 1,
      p_confirmation_method: "account",
      p_publication_confirmed: true,
    });
    await approveRevision(moderator.client, firstRevisionId);

    const { data: replacementId } = await owner.client.rpc(
      "create_next_draft_revision",
      {
        p_story_id: storyId,
      },
    );
    const { data: st1 } = await owner.client.rpc("get_my_story_with_draft", {
      p_story_id: storyId,
    });
    await owner.client.rpc("submit_revision_with_consent", {
      p_revision_id: replacementId as unknown as string,
      p_expected_version: st1![0].version,
      p_confirmation_method: "account",
      p_publication_confirmed: true,
    });

    const { error } = await owner.client.rpc("withdraw_unstarted_submission", {
      p_story_id: storyId,
    });
    expect(error).toBeNull();

    // current_draft_revision_id is cleared, so get_my_story_with_draft falls
    // back to the still-live published revision — not the now-withdrawn one.
    const { data: st2 } = await owner.client.rpc("get_my_story_with_draft", {
      p_story_id: storyId,
    });
    expect(st2?.[0]?.lifecycle_status).toBe("published");
    expect(st2?.[0]?.revision_status).toBe("approved");

    // The withdrawn revision itself is frozen — create_next_draft_revision()
    // is the only way back to editing, exactly like rejected/changes_requested.
    const { data: freshDraftId, error: nextError } = await owner.client.rpc(
      "create_next_draft_revision",
      { p_story_id: storyId },
    );
    expect(nextError).toBeNull();
    expect(freshDraftId).toBeTruthy();
    const { data: st3 } = await owner.client.rpc("get_my_story_with_draft", {
      p_story_id: storyId,
    });
    expect(st3?.[0]?.revision_status).toBe("draft");
    expect(st3?.[0]?.revision_id).toBe(freshDraftId);
  }, 30000);
});

describe("destination/region and cross-story media integrity", () => {
  it("rejects a destination that does not belong to the given region", async () => {
    // Lookup tables have real RLS grants; seed two disjoint region/destination
    // pairs via the admin account rather than assuming any exist already.
    const { data: regionA, error: regionAError } = await admin.client
      .from("regions")
      .insert({ slug: slug("region-a"), name: "RLS Test Region A" })
      .select("id")
      .single();
    expect(regionAError).toBeNull();
    const { data: regionB, error: regionBError } = await admin.client
      .from("regions")
      .insert({ slug: slug("region-b"), name: "RLS Test Region B" })
      .select("id")
      .single();
    expect(regionBError).toBeNull();
    const { data: destB, error: destBError } = await admin.client
      .from("destinations")
      .insert({
        region_id: regionB!.id,
        slug: slug("dest-b"),
        name: "RLS Test Destination B",
      })
      .select("id")
      .single();
    expect(destBError).toBeNull();

    const { data: created } = await owner.client.rpc(
      "create_self_service_draft",
      {
        p_title: slug("region-integrity"),
      },
    );
    const revisionId = created![0].revision_id;

    const { error } = await owner.client.rpc("set_revision_locations", {
      p_revision_id: revisionId,
      p_expected_version: 1,
      p_locations: [{ region_id: regionA!.id, destination_id: destB!.id }],
    });
    expect(error).not.toBeNull();
  }, 30000);
});

describe("reports", () => {
  it("a reporter can only see their own reports", async () => {
    const { data: created } = await owner.client.rpc(
      "create_self_service_draft",
      {
        p_title: slug("report-target"),
      },
    );
    const revisionId = created![0].revision_id;
    const storyId = created![0].story_id;
    const { error: submitError } = await owner.client.rpc(
      "submit_revision_with_consent",
      {
        p_revision_id: revisionId,
        p_expected_version: 1,
        p_confirmation_method: "account",
        p_publication_confirmed: true,
      },
    );
    expect(submitError).toBeNull();
    const { error: moderateError } = await approveRevision(
      moderator.client,
      revisionId,
    );
    expect(moderateError).toBeNull();

    const { error: reportError } = await other.client.rpc(
      "create_story_report",
      {
        p_story_id: storyId,
        p_category: "misinformation",
      },
    );
    expect(reportError).toBeNull();

    const { data: ownerReports } = await owner.client.rpc("list_my_reports");
    expect(ownerReports).toEqual([]);

    const { data: otherReports } = await other.client.rpc("list_my_reports");
    expect(otherReports?.some((r) => r.story_id === storyId)).toBe(true);
  }, 30000);
});
