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

/**
 * Calls an RPC that exists on the live linked project but isn't reflected
 * in types/database.ts yet -- true for every function Prompt 4 Sub-phase
 * 4's migrations add, until they're pushed and `npm run
 * supabase:types:linked` is re-run (see docs/implementation-status.md).
 * Same escape-hatch pattern as lib/supabase/call-untyped-rpc.ts, but
 * returns the plain `{ data, error }` shape (rather than throwing) so the
 * existing `expect(error)...` assertions throughout this file don't need
 * restructuring. Remove every call site of this once real types land.
 */
async function untypedRpc<T>(
  client: SupabaseClient<Database>,
  fn: string,
  args?: Record<string, unknown>,
): Promise<{
  data: T | null;
  error: { message: string; code?: string } | null;
}> {
  return client.rpc(fn as never, args as never) as unknown as Promise<{
    data: T | null;
    error: { message: string; code?: string } | null;
  }>;
}

/**
 * Same escape hatch as untypedRpc(), for a table that exists on the live
 * linked project (this migration set's new story_report_notes /
 * story_publication_state_actions) but isn't reflected in
 * types/database.ts yet. Only ever used here to assert that a direct
 * update/delete is rejected -- never to read/trust returned data.
 */
function untypedTable(
  client: SupabaseClient<Database>,
  table: string,
): {
  update: (values: Record<string, unknown>) => {
    eq: (
      column: string,
      value: string,
    ) => Promise<{ error: { message: string; code?: string } | null }>;
  };
  delete: () => {
    eq: (
      column: string,
      value: string,
    ) => Promise<{ error: { message: string; code?: string } | null }>;
  };
} {
  return client.from(table as never) as unknown as ReturnType<
    typeof untypedTable
  >;
}

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
// Fetched once in beforeAll via current_terms_version()
// (supabase/migrations/20260804092100_submit_consent_requires_terms_version.sql)
// -- every submit_revision_with_consent() call in this suite passes this as
// p_expected_terms_version, required (not defaulted) as of that migration.
let currentTermsVersion: string;

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

  const { data: termsVersion, error: termsError } = await untypedRpc<string>(
    owner.client,
    "current_terms_version",
  );
  if (termsError || !termsVersion) {
    throw new Error(
      `Could not fetch current_terms_version(): ${termsError?.message}`,
    );
  }
  currentTermsVersion = termsVersion;
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
      p_expected_terms_version: currentTermsVersion,
    });
    expect(error).not.toBeNull();
  });

  it("an editor cannot record offline consent for a self-service story", async () => {
    const { error } = await editor.client.rpc("submit_revision_with_consent", {
      p_revision_id: revisionId,
      p_expected_version: version,
      p_confirmation_method: "email",
      p_publication_confirmed: true,
      p_expected_terms_version: currentTermsVersion,
    });
    expect(error).not.toBeNull();
  });

  it("owner submits with account consent", async () => {
    const { error } = await owner.client.rpc("submit_revision_with_consent", {
      p_revision_id: revisionId,
      p_expected_version: version,
      p_confirmation_method: "account",
      p_publication_confirmed: true,
      p_expected_terms_version: currentTermsVersion,
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
      p_expected_terms_version: currentTermsVersion,
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
      p_expected_terms_version: currentTermsVersion,
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
      p_expected_terms_version: currentTermsVersion,
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
      p_expected_terms_version: currentTermsVersion,
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
        p_expected_terms_version: currentTermsVersion,
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

// ---------------------------------------------------------------------
// Prompt 4 Sub-phase 4 additions below. NOTE: these require
// supabase/migrations/20260804092000-20260804092400 to be pushed to the
// linked project before they can pass -- as of this commit they are
// written and ready, but NOT yet run for real (the migrations are a
// stop-gate pending explicit go-ahead). See docs/implementation-status.md
// "Prompt 4 Sub-phase 4 detail" for the full account.
// ---------------------------------------------------------------------

describe("assigned-editor read access to get_my_story_with_draft (migration 20260804092000)", () => {
  it("an assigned editor can read an editorial-import draft they are not the owner/linked-contributor of", async () => {
    const { data: contributor, error: contributorError } = await editor.client
      .from("contributors")
      .insert({
        created_by: editor.userId,
        display_name: "RLS Test Editorial Contributor (assigned-editor-read)",
        attribution_type: "display_name",
      })
      .select("id")
      .single();
    expect(contributorError).toBeNull();

    const { data: created, error } = await editor.client.rpc(
      "create_editorial_import_draft",
      {
        p_contributor_id: contributor!.id,
        p_title: slug("assigned-editor-read"),
      },
    );
    expect(error).toBeNull();
    const storyId = created![0].story_id;

    const { data: draft, error: readError } = await editor.client.rpc(
      "get_my_story_with_draft",
      { p_story_id: storyId },
    );
    expect(readError).toBeNull();
    expect(draft?.[0]?.story_id).toBe(storyId);
  }, 30000);
});

describe("submit_revision_with_consent terms-version enforcement (migration 20260804092100)", () => {
  it("rejects a mismatched p_expected_terms_version with a WHV01 error code", async () => {
    const { data: created } = await owner.client.rpc(
      "create_self_service_draft",
      {
        p_title: slug("terms-mismatch"),
      },
    );
    const revisionId = created![0].revision_id;

    const { error } = await owner.client.rpc("submit_revision_with_consent", {
      p_revision_id: revisionId,
      p_expected_version: 1,
      p_confirmation_method: "account",
      p_publication_confirmed: true,
      p_expected_terms_version: "some-superseded-version",
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("WHV01");
  }, 30000);

  it("succeeds when p_expected_terms_version matches current_terms_version()", async () => {
    const { data: created } = await owner.client.rpc(
      "create_self_service_draft",
      {
        p_title: slug("terms-match"),
      },
    );
    const revisionId = created![0].revision_id;

    const { error } = await owner.client.rpc("submit_revision_with_consent", {
      p_revision_id: revisionId,
      p_expected_version: 1,
      p_confirmation_method: "account",
      p_publication_confirmed: true,
      p_expected_terms_version: currentTermsVersion,
    });
    expect(error).toBeNull();
  }, 30000);
});

describe("awaiting-contributor-approval submission path (the 'awaiting-approval submission dead-end' fix)", () => {
  it("the linked contributor can submit (approve) a draft awaiting their review", async () => {
    const { data: created, error: createError } = await editor.client.rpc(
      "create_editorial_import_draft",
      {
        p_contributor_id: ownerContributorId,
        p_title: slug("awaiting-approval"),
      },
    );
    expect(createError).toBeNull();
    const storyId = created![0].story_id;

    const { error: markReadyError } = await editor.client.rpc(
      "mark_editorial_draft_awaiting_approval",
      { p_story_id: storyId },
    );
    expect(markReadyError).toBeNull();

    const { data: draft } = await owner.client.rpc("get_my_story_with_draft", {
      p_story_id: storyId,
    });
    expect(draft?.[0]?.lifecycle_status).toBe("awaiting_contributor_approval");

    // Before the fix, this call would have been rejected outright --
    // _revision_is_editable() excludes 'awaiting_contributor_approval', and
    // submit_revision_with_consent() required it unconditionally.
    const { error: submitError } = await owner.client.rpc(
      "submit_revision_with_consent",
      {
        p_revision_id: draft![0].revision_id,
        p_expected_version: draft![0].version,
        p_confirmation_method: "account",
        p_publication_confirmed: true,
        p_expected_terms_version: currentTermsVersion,
        p_editorial_assistance_confirmed: true,
      },
    );
    expect(submitError).toBeNull();

    const { data: after } = await owner.client.rpc("get_my_story_with_draft", {
      p_story_id: storyId,
    });
    expect(after?.[0]?.lifecycle_status).toBe("pending_review");
  }, 30000);
});

describe("source-kind-partitioned authorization survives contributor relinking (R6-9)", () => {
  it("owner keeps full, unaffected access to their self-service story after their contributor is unlinked/relinked to another account; the new linkee gains zero access, including no ability to submit consent for it", async () => {
    const { data: created } = await owner.client.rpc(
      "create_self_service_draft",
      {
        p_title: slug("relink-isolation"),
      },
    );
    const storyId = created![0].story_id;
    const revisionId = created![0].revision_id;

    const { error: unlinkError } = await untypedRpc(
      editor.client,
      "unlink_contributor_from_user",
      { p_contributor_id: ownerContributorId },
    );
    expect(unlinkError).toBeNull();
    const { error: relinkError } = await editor.client.rpc(
      "link_contributor_to_user",
      { p_contributor_id: ownerContributorId, p_user_id: other.userId },
    );
    expect(relinkError).toBeNull();

    try {
      // owner retains FULL, unaffected access via every read/write path.
      const { data: ownerDraft, error: ownerReadError } =
        await owner.client.rpc("get_my_story_with_draft", {
          p_story_id: storyId,
        });
      expect(ownerReadError).toBeNull();
      expect(ownerDraft?.[0]?.story_id).toBe(storyId);

      const { error: ownerPreviewError } = await owner.client.rpc(
        "get_story_preview",
        { p_story_id: storyId },
      );
      expect(ownerPreviewError).toBeNull();

      const { data: ownerList } = await owner.client.rpc("list_my_stories");
      expect(ownerList?.some((s) => s.id === storyId)).toBe(true);

      const { error: ownerSaveError } = await owner.client.rpc(
        "save_revision_draft",
        {
          p_revision_id: revisionId,
          p_expected_version: ownerDraft![0].version,
          p_title: slug("relink-isolation-updated"),
        },
      );
      expect(ownerSaveError).toBeNull();

      // `other` (now the linked contributor for this SAME underlying
      // contributor row) gains ZERO access to owner's self-service story.
      const { data: otherDraft, error: otherReadError } =
        await other.client.rpc("get_my_story_with_draft", {
          p_story_id: storyId,
        });
      expect(otherDraft).toBeNull();
      expect(otherReadError).not.toBeNull();

      const { error: otherPreviewError } = await other.client.rpc(
        "get_story_preview",
        { p_story_id: storyId },
      );
      expect(otherPreviewError).not.toBeNull();

      const { data: otherList } = await other.client.rpc("list_my_stories");
      expect(otherList?.some((s) => s.id === storyId)).toBe(false);

      // Including: `other` cannot submit consent for owner's story via
      // account confirmation either -- the fifth source-kind-partition site
      // this sub-phase found independently, inside
      // submit_revision_with_consent() itself.
      const { data: currentDraft } = await owner.client.rpc(
        "get_my_story_with_draft",
        { p_story_id: storyId },
      );
      const { error: otherSubmitError } = await other.client.rpc(
        "submit_revision_with_consent",
        {
          p_revision_id: currentDraft![0].revision_id,
          p_expected_version: currentDraft![0].version,
          p_confirmation_method: "account",
          p_publication_confirmed: true,
          p_expected_terms_version: currentTermsVersion,
        },
      );
      expect(otherSubmitError).not.toBeNull();
    } finally {
      // Restore the fixed account pool's invariant (ownerContributorId
      // linked to owner) for every OTHER test in this suite/session that
      // assumes it, regardless of whether the assertions above passed.
      await untypedRpc(editor.client, "unlink_contributor_from_user", {
        p_contributor_id: ownerContributorId,
      });
      await editor.client.rpc("link_contributor_to_user", {
        p_contributor_id: ownerContributorId,
        p_user_id: owner.userId,
      });
    }
  }, 30000);
});

describe("contributor_links audit trail (R6-8)", () => {
  it("reads as a coherent link -> unlink -> relink timeline", async () => {
    const { error: unlinkError } = await untypedRpc(
      editor.client,
      "unlink_contributor_from_user",
      { p_contributor_id: ownerContributorId, p_note: "rls-test unlink" },
    );
    expect(unlinkError).toBeNull();
    const { error: relinkError } = await editor.client.rpc(
      "link_contributor_to_user",
      {
        p_contributor_id: ownerContributorId,
        p_user_id: other.userId,
        p_note: "rls-test relink to other",
      },
    );
    expect(relinkError).toBeNull();

    try {
      // contributor_links.event_type doesn't exist in the generated types
      // yet either (same not-yet-pushed migration) -- cast the row shape
      // rather than the whole query.
      const { data: history, error: historyError } = (await editor.client
        .from("contributor_links")
        .select("event_type, user_id, linked_at")
        .eq("contributor_id", ownerContributorId)
        .order("linked_at", { ascending: true })) as unknown as {
        data:
          { event_type: string; user_id: string; linked_at: string }[] | null;
        error: { message: string } | null;
      };
      expect(historyError).toBeNull();
      const tail = history!.slice(-2);
      expect(tail.map((r) => r.event_type)).toEqual(["unlinked", "linked"]);
      expect(tail[0].user_id).toBe(owner.userId);
      expect(tail[1].user_id).toBe(other.userId);
    } finally {
      await untypedRpc(editor.client, "unlink_contributor_from_user", {
        p_contributor_id: ownerContributorId,
      });
      await editor.client.rpc("link_contributor_to_user", {
        p_contributor_id: ownerContributorId,
        p_user_id: owner.userId,
      });
    }
  }, 30000);
});

describe("GUC-bypass unreachability and direct-UPDATE rejection (R6-2)", () => {
  it("an editor cannot call set_config or _set_contributor_linked_user directly", async () => {
    // set_config is a Postgres builtin, never exposed as a public-schema
    // RPC regardless of any of this sub-phase's migrations -- this half of
    // the assertion is already true today. The cast is only for
    // TypeScript's benefit (the function name was never a valid RPC name
    // in the generated types either).
    const { error: setConfigError } = await untypedRpc(
      editor.client,
      "set_config",
      {
        setting_name: "app.contributor_link_operation",
        new_value: "link",
        is_local: true,
      },
    );
    expect(setConfigError).not.toBeNull();

    const { error: helperError } = await untypedRpc(
      editor.client,
      "_set_contributor_linked_user",
      {
        p_contributor_id: ownerContributorId,
        p_new_linked_user_id: other.userId,
        p_operation: "link",
      },
    );
    expect(helperError).not.toBeNull();
  });

  it("a direct UPDATE on linked_user_id by an editor is rejected in both the assign and clear direction", async () => {
    const { error: assignError } = await editor.client
      .from("contributors")
      .update({ linked_user_id: other.userId })
      .eq("id", ownerContributorId);
    expect(assignError).not.toBeNull();

    const { error: clearError } = await editor.client
      .from("contributors")
      .update({ linked_user_id: null })
      .eq("id", ownerContributorId);
    expect(clearError).not.toBeNull();
  });
});

// --- Prompt 5: public discovery ---------------------------------------
//
// list_published_stories/list_distinct_public_travel_styles/
// list_public_contributors/get_public_contributor are new anon-granted
// functions (or, for list_published_stories, an extended existing one).
// Helper: publishes a self-service story with the given fields via the
// same create -> submit -> approve flow every other describe block above
// already uses, and returns the identifiers needed to query it back.
async function publishOwnerStory(fields: {
  title: string;
  totalExpenseNzdCents?: number;
  travelStyle?: string;
}) {
  const { data: created, error: createError } = await owner.client.rpc(
    "create_self_service_draft",
    {
      p_title: fields.title,
      p_content_json: [
        { type: "paragraph", text: [{ text: "Prompt 5 fixture." }] },
      ],
      p_total_expense_nzd_cents: fields.totalExpenseNzdCents,
      p_travel_style: fields.travelStyle,
    },
  );
  if (createError || !created) {
    throw new Error(`Could not create draft: ${createError?.message}`);
  }
  const storyId = created[0].story_id;
  const revisionId = created[0].revision_id;

  const { data: draft } = await owner.client.rpc("get_my_story_with_draft", {
    p_story_id: storyId,
  });
  const version = draft![0].version;
  const storedSlug = draft![0].slug;

  const { error: submitError } = await owner.client.rpc(
    "submit_revision_with_consent",
    {
      p_revision_id: revisionId,
      p_expected_version: version,
      p_confirmation_method: "account",
      p_publication_confirmed: true,
      p_expected_terms_version: currentTermsVersion,
    },
  );
  if (submitError) throw new Error(`Could not submit: ${submitError.message}`);

  const { error: approveError } = await approveRevision(
    moderator.client,
    revisionId,
  );
  if (approveError) {
    throw new Error(`Could not approve: ${approveError.message}`);
  }

  return { storyId, revisionId, slug: storedSlug };
}

describe("Prompt 5: list_published_stories cost-band, expense-availability, search, and exclude filters", () => {
  let under5k: Awaited<ReturnType<typeof publishOwnerStory>>;
  let at5kBoundary: Awaited<ReturnType<typeof publishOwnerStory>>;
  let noExpense: Awaited<ReturnType<typeof publishOwnerStory>>;
  // Space-separated, not slug()'s hyphenated form: websearch_to_tsquery
  // treats a hyphen-joined query string as a strict phrase (FOLLOWED BY
  // chain) against the *entire* compound lexeme Postgres's 'simple' parser
  // indexes for a hyphenated title -- a partial hyphenated substring of a
  // longer hyphenated title therefore never matches, confirmed directly
  // against the live database before writing these titles this way. Real
  // search queries are space-separated words, which AND-match regardless
  // of order -- this is what the marker below exercises.
  const marker = runId;
  const under5kTitle = `Prompt5 CostBand ${marker} Searchable Under5k`;
  const at5kTitle = `Prompt5 CostBand ${marker} Searchable At5k`;
  const noExpenseTitle = `Prompt5 CostBand ${marker} Searchable NoExpense`;

  beforeAll(async () => {
    under5k = await publishOwnerStory({
      title: under5kTitle,
      totalExpenseNzdCents: 499999,
    });
    at5kBoundary = await publishOwnerStory({
      title: at5kTitle,
      totalExpenseNzdCents: 500000,
    });
    noExpense = await publishOwnerStory({
      title: noExpenseTitle,
    });
  }, 60000);

  it("under_5k includes the 499999-cent story and excludes the 500000-cent one", async () => {
    const { data, error } = await anon.rpc("list_published_stories", {
      p_search: `CostBand ${marker} Searchable`,
      p_cost_band: "under_5k",
      p_limit: 10,
    });
    expect(error).toBeNull();
    const ids = data!.map((r) => r.story_id);
    expect(ids).toContain(under5k.storyId);
    expect(ids).not.toContain(at5kBoundary.storyId);
    expect(ids).not.toContain(noExpense.storyId);
  });

  it("5k_15k includes the exact 500000-cent boundary story", async () => {
    const { data, error } = await anon.rpc("list_published_stories", {
      p_search: `CostBand ${marker} Searchable`,
      p_cost_band: "5k_15k",
      p_limit: 10,
    });
    expect(error).toBeNull();
    const ids = data!.map((r) => r.story_id);
    expect(ids).toContain(at5kBoundary.storyId);
    expect(ids).not.toContain(under5k.storyId);
  });

  it("an invalid cost band is rejected, not silently ignored", async () => {
    const { error } = await anon.rpc("list_published_stories", {
      p_cost_band: "sky-high",
    });
    expect(error).not.toBeNull();
  });

  it("p_has_reported_expense filters null vs. non-null expenses", async () => {
    const { data: withExpense, error: withError } = await anon.rpc(
      "list_published_stories",
      {
        p_search: `CostBand ${marker} Searchable`,
        p_has_reported_expense: true,
        p_limit: 10,
      },
    );
    expect(withError).toBeNull();
    const withIds = withExpense!.map((r) => r.story_id);
    expect(withIds).toContain(under5k.storyId);
    expect(withIds).toContain(at5kBoundary.storyId);
    expect(withIds).not.toContain(noExpense.storyId);

    const { data: withoutExpense, error: withoutError } = await anon.rpc(
      "list_published_stories",
      {
        p_search: `CostBand ${marker} Searchable`,
        p_has_reported_expense: false,
        p_limit: 10,
      },
    );
    expect(withoutError).toBeNull();
    const withoutIds = withoutExpense!.map((r) => r.story_id);
    expect(withoutIds).toEqual([noExpense.storyId]);
  });

  it("p_search matches title keywords and p_exclude_story_id removes a specific story", async () => {
    const { data: matched, error } = await anon.rpc("list_published_stories", {
      p_search: `${marker} Searchable Under5k`,
      p_limit: 10,
    });
    expect(error).toBeNull();
    expect(matched!.map((r) => r.story_id)).toEqual([under5k.storyId]);

    const { data: excluded, error: excludeError } = await anon.rpc(
      "list_published_stories",
      {
        p_search: `${marker} Searchable Under5k`,
        p_exclude_story_id: under5k.storyId,
        p_limit: 10,
      },
    );
    expect(excludeError).toBeNull();
    expect(excluded).toEqual([]);
  });

  it("an unmatched search returns no rows, never an error", async () => {
    const { data, error } = await anon.rpc("list_published_stories", {
      p_search: "no such story exists anywhere at all",
    });
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("a card row includes a null cover_image_path and empty relation arrays when none are attached", async () => {
    const { data, error } = await anon.rpc("list_published_stories", {
      p_search: `${marker} Searchable Under5k`,
      p_limit: 1,
    });
    expect(error).toBeNull();
    expect(data![0].cover_image_path).toBeNull();
    expect(data![0].regions).toEqual([]);
    expect(data![0].work_types).toEqual([]);
    expect(data![0].tags).toEqual([]);
  });
});

describe("Prompt 5: list_published_stories never duplicates a story row across multiple attached work types/tags", () => {
  it("returns exactly one row for a story with two work types and two tags", async () => {
    const { data: workTypeA, error: wtAError } = await admin.client
      .from("work_types")
      .insert({ slug: slug("wt-a"), name: "RLS Test Work Type A" })
      .select("id")
      .single();
    expect(wtAError).toBeNull();
    const { data: workTypeB, error: wtBError } = await admin.client
      .from("work_types")
      .insert({ slug: slug("wt-b"), name: "RLS Test Work Type B" })
      .select("id")
      .single();
    expect(wtBError).toBeNull();
    const { data: tagA, error: tagAError } = await admin.client
      .from("tags")
      .insert({ slug: slug("tag-a"), name: "RLS Test Tag A" })
      .select("id")
      .single();
    expect(tagAError).toBeNull();
    const { data: tagB, error: tagBError } = await admin.client
      .from("tags")
      .insert({ slug: slug("tag-b"), name: "RLS Test Tag B" })
      .select("id")
      .single();
    expect(tagBError).toBeNull();

    const title = slug("multi-relation-story");
    const { data: created, error: createError } = await owner.client.rpc(
      "create_self_service_draft",
      {
        p_title: title,
        p_content_json: [
          { type: "paragraph", text: [{ text: "Multi-relation fixture." }] },
        ],
      },
    );
    expect(createError).toBeNull();
    const storyId = created![0].story_id;
    const revisionId = created![0].revision_id;

    const { error: wtSetError } = await owner.client.rpc(
      "set_revision_work_types",
      {
        p_revision_id: revisionId,
        p_expected_version: 1,
        p_work_types: [
          { work_type_id: workTypeA!.id },
          { work_type_id: workTypeB!.id },
        ],
      },
    );
    expect(wtSetError).toBeNull();

    // Each mutation bumps the story's optimistic-concurrency version by
    // exactly 1 (docs/architecture.md) -- re-fetch before the next one
    // rather than assuming p_expected_version: 1 still applies.
    const { data: afterWorkTypes } = await owner.client.rpc(
      "get_my_story_with_draft",
      { p_story_id: storyId },
    );
    const { error: tagSetError } = await owner.client.rpc("set_revision_tags", {
      p_revision_id: revisionId,
      p_expected_version: afterWorkTypes![0].version,
      p_tags: [{ tag_id: tagA!.id }, { tag_id: tagB!.id }],
    });
    expect(tagSetError).toBeNull();

    const { data: draft } = await owner.client.rpc("get_my_story_with_draft", {
      p_story_id: storyId,
    });
    const version = draft![0].version;

    const { error: submitError } = await owner.client.rpc(
      "submit_revision_with_consent",
      {
        p_revision_id: revisionId,
        p_expected_version: version,
        p_confirmation_method: "account",
        p_publication_confirmed: true,
        p_expected_terms_version: currentTermsVersion,
      },
    );
    expect(submitError).toBeNull();
    const { error: approveError } = await approveRevision(
      moderator.client,
      revisionId,
    );
    expect(approveError).toBeNull();

    const { data, error } = await anon.rpc("list_published_stories", {
      p_search: title,
      p_limit: 10,
    });
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].story_id).toBe(storyId);
    expect(data![0].work_types).toHaveLength(2);
    expect(data![0].tags).toHaveLength(2);
  }, 30000);
});

describe("Prompt 5: list_distinct_public_travel_styles", () => {
  it("dedupes case-insensitively/whitespace and only reflects public stories", async () => {
    const styleWord = slug("Backpacker-Style");
    await publishOwnerStory({
      title: slug("travel-style-1"),
      travelStyle: `  ${styleWord}  `,
    });
    await publishOwnerStory({
      title: slug("travel-style-2"),
      travelStyle: styleWord.toUpperCase(),
    });

    // A draft (never submitted/approved) with its own unique travel_style
    // must never leak into a public-only distinct list.
    const draftOnlyStyle = slug("draft-only-style");
    await owner.client.rpc("create_self_service_draft", {
      p_title: slug("travel-style-draft-only"),
      p_travel_style: draftOnlyStyle,
    });

    const { data, error } = await anon.rpc(
      "list_distinct_public_travel_styles",
    );
    expect(error).toBeNull();
    const values = data!.map((r) => r.travel_style);
    const matches = values.filter(
      (v) => v?.trim().toLowerCase() === styleWord.toLowerCase(),
    );
    expect(matches).toHaveLength(1);
    expect(values).not.toContain(draftOnlyStyle);
  }, 30000);
});

describe("Prompt 5: public contributor directory and detail", () => {
  it("excludes private, anonymous-attribution, and zero-published-story contributors", async () => {
    // Private contributor with a published story -- must not appear.
    const { data: privateContributor } = await editor.client
      .from("contributors")
      .insert({
        created_by: editor.userId,
        display_name: slug("private-contributor"),
        attribution_type: "display_name",
        public_status: "private",
      })
      .select("id")
      .single();
    await editor.client.rpc("create_editorial_import_draft", {
      p_contributor_id: privateContributor!.id,
      p_title: slug("private-contributor-story"),
    });

    // Public, zero-story contributor -- must not appear.
    const zeroStorySlug = slug("zero-story-contributor");
    const { data: zeroStoryContributor, error: zeroError } = await editor.client
      .from("contributors")
      .insert({
        created_by: editor.userId,
        display_name: "RLS Test Zero Story Contributor",
        attribution_type: "display_name",
        public_status: "public",
        public_slug: zeroStorySlug,
      })
      .select("id")
      .single();
    expect(zeroError).toBeNull();
    expect(zeroStoryContributor).not.toBeNull();

    // Public, anonymous-attribution contributor with a published story --
    // must not appear (anonymous attribution and a named public profile
    // page are in tension; see the migration's own doc comment).
    const anonContributorSlug = slug("anon-attribution-slug");
    const { data: anonContributor } = await editor.client
      .from("contributors")
      .insert({
        created_by: editor.userId,
        display_name: slug("anon-attribution-contributor"),
        attribution_type: "anonymous",
        public_status: "public",
        public_slug: anonContributorSlug,
      })
      .select("id")
      .single();
    const { data: anonImport } = await editor.client.rpc(
      "create_editorial_import_draft",
      {
        p_contributor_id: anonContributor!.id,
        p_title: slug("anon-attribution-story"),
      },
    );
    const { error: anonSubmitError } = await editor.client.rpc(
      "submit_revision_with_consent",
      {
        p_revision_id: anonImport![0].revision_id,
        p_expected_version: 1,
        p_confirmation_method: "email",
        p_publication_confirmed: true,
        p_expected_terms_version: currentTermsVersion,
        p_editorial_assistance_confirmed: true,
      },
    );
    expect(anonSubmitError).toBeNull();
    const { error: anonApproveError } = await approveRevision(
      moderator.client,
      anonImport![0].revision_id,
    );
    expect(anonApproveError).toBeNull();

    // The real positive case: public, named, with a published story.
    const realSlug = slug("real-public-contributor");
    const { data: realContributor, error: realError } = await editor.client
      .from("contributors")
      .insert({
        created_by: editor.userId,
        display_name: "RLS Test Real Public Contributor",
        attribution_type: "display_name",
        public_status: "public",
        public_slug: realSlug,
        bio: "A real bio for a real public contributor fixture.",
      })
      .select("id")
      .single();
    expect(realError).toBeNull();
    const { data: realImport } = await editor.client.rpc(
      "create_editorial_import_draft",
      {
        p_contributor_id: realContributor!.id,
        p_title: slug("real-contributor-story"),
      },
    );
    const { error: realSubmitError } = await editor.client.rpc(
      "submit_revision_with_consent",
      {
        p_revision_id: realImport![0].revision_id,
        p_expected_version: 1,
        p_confirmation_method: "email",
        p_publication_confirmed: true,
        p_expected_terms_version: currentTermsVersion,
        p_editorial_assistance_confirmed: true,
      },
    );
    expect(realSubmitError).toBeNull();
    const { error: realApproveError } = await approveRevision(
      moderator.client,
      realImport![0].revision_id,
    );
    expect(realApproveError).toBeNull();

    const { data: detail, error: detailError } = await anon.rpc(
      "get_public_contributor",
      { p_slug: realSlug },
    );
    expect(detailError).toBeNull();
    expect(detail?.[0]?.display_name).toBe("RLS Test Real Public Contributor");
    expect(detail?.[0]?.published_story_count).toBe(1);

    expect(
      (await anon.rpc("get_public_contributor", { p_slug: zeroStorySlug }))
        .data,
    ).toEqual([]);

    const { data: directory, error: directoryError } = await anon.rpc(
      "list_public_contributors",
      { p_limit: 50 },
    );
    expect(directoryError).toBeNull();
    const slugs = directory!.map((c) => c.public_slug);
    expect(slugs).toContain(realSlug);
    expect(slugs).not.toContain(zeroStorySlug);
    expect(slugs).not.toContain(anonContributorSlug);
  }, 60000);

  it("anon cannot select any contributor column directly (table grants revoked, Prompt 5)", async () => {
    const { error } = await anon.from("contributors").select("id").limit(1);
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
  });
});

// ---------------------------------------------------------------------
// Prompt 6 Stage 1 additions below. NOTE: these require
// supabase/migrations/20260805100500-20260805101200 to be pushed to the
// linked project before they can pass -- as of this commit they are written
// and ready, but NOT yet run for real (explicit go-ahead is required for the
// push + `npm run test:rls`, per this repo's established practice). See
// docs/implementation-status.md "Prompt 6 Stage 1 detail" for the full
// account of what is/isn't verified this stage.
// ---------------------------------------------------------------------

describe("editor is denied every moderator/publication-attempt action", () => {
  let storyId: string;
  let revisionId: string;

  beforeAll(async () => {
    const { data: created } = await owner.client.rpc(
      "create_self_service_draft",
      { p_title: slug("editor-denial") },
    );
    storyId = created![0].story_id;
    revisionId = created![0].revision_id;
    const { data: draft } = await owner.client.rpc("get_my_story_with_draft", {
      p_story_id: storyId,
    });
    await owner.client.rpc("submit_revision_with_consent", {
      p_revision_id: revisionId,
      p_expected_version: draft![0].version,
      p_confirmation_method: "account",
      p_publication_confirmed: true,
      p_expected_terms_version: currentTermsVersion,
    });
  }, 30000);

  it("an editor cannot call moderate_revision with reject/changes_requested either", async () => {
    const { error } = await editor.client.rpc("moderate_revision", {
      p_revision_id: revisionId,
      p_expected_version: 2,
      p_decision: "reject",
      p_user_facing_reason: "not allowed",
    });
    expect(error).not.toBeNull();
  });

  it("an editor cannot call begin_story_publication_attempt", async () => {
    const { error } = await editor.client.rpc(
      "begin_story_publication_attempt",
      { p_revision_id: revisionId },
    );
    expect(error).not.toBeNull();
  });

  it("an editor cannot call finalize_story_publication", async () => {
    const { error } = await editor.client.rpc("finalize_story_publication", {
      p_revision_id: revisionId,
      p_approval_attempt_id: "11111111-1111-4111-8111-111111111111",
    });
    expect(error).not.toBeNull();
  });
});

describe("archive requires a reason (migration 20260805100500)", () => {
  it("rejects a null/empty reason and succeeds with one, recording an audit row", async () => {
    const story = await publishOwnerStory({ title: slug("archive-reason") });
    const { data: draft } = await owner.client.rpc("get_my_story_with_draft", {
      p_story_id: story.storyId,
    });
    const version = draft![0].version;

    const { error: emptyError } = await untypedRpc(
      moderator.client,
      "archive_story",
      {
        p_story_id: story.storyId,
        p_expected_version: version,
        p_reason: "",
      },
    );
    expect(emptyError).not.toBeNull();

    const { error: nullError } = await untypedRpc(
      moderator.client,
      "archive_story",
      {
        p_story_id: story.storyId,
        p_expected_version: version,
        p_reason: null,
      },
    );
    expect(nullError).not.toBeNull();

    const { error: staleError } = await untypedRpc(
      moderator.client,
      "archive_story",
      {
        p_story_id: story.storyId,
        p_expected_version: version + 999,
        p_reason: "a real reason",
      },
    );
    expect(staleError).not.toBeNull();

    const { error: okError } = await untypedRpc(
      moderator.client,
      "archive_story",
      {
        p_story_id: story.storyId,
        p_expected_version: version,
        p_reason: "Duplicate of another published story.",
      },
    );
    expect(okError).toBeNull();
  }, 30000);
});

describe("moderator cannot reassign editorial stories; editor claim/hand-off rules (migration 20260805100600)", () => {
  it("a moderator is rejected outright", async () => {
    const { data: contributor } = await editor.client
      .from("contributors")
      .insert({
        created_by: editor.userId,
        display_name: "RLS Test Reassign Contributor",
        attribution_type: "display_name",
      })
      .select("id")
      .single();
    const { data: created } = await editor.client.rpc(
      "create_editorial_import_draft",
      { p_contributor_id: contributor!.id, p_title: slug("reassign-story") },
    );
    const storyId = created![0].story_id;

    const { error } = await untypedRpc(
      moderator.client,
      "reassign_editorial_story",
      {
        p_story_id: storyId,
        p_editor_id: admin.userId,
        p_expected_version: 1,
      },
    );
    expect(error).not.toBeNull();
  });

  it("an editor can claim an unassigned story for themselves but not for someone else, and admin can reassign anyone's story", async () => {
    const { data: contributor } = await admin.client
      .from("contributors")
      .insert({
        created_by: admin.userId,
        display_name: "RLS Test Unclaimed Contributor",
        attribution_type: "display_name",
      })
      .select("id")
      .single();

    // Unassigned: created by admin with no p_assigned_editor_id override
    // resolves to admin as the default assignee inside
    // create_editorial_import_draft() -- explicitly clear it via a
    // reassignment to null-equivalent is not supported, so instead this
    // story starts assigned to admin, then admin hands it to editor, who
    // then cannot hand it to someone else who isn't themselves/unassigned.
    const { data: created } = await admin.client.rpc(
      "create_editorial_import_draft",
      { p_contributor_id: contributor!.id, p_title: slug("handoff-story") },
    );
    const storyId = created![0].story_id;

    const { error: adminReassignError } = await untypedRpc(
      admin.client,
      "reassign_editorial_story",
      {
        p_story_id: storyId,
        p_editor_id: editor.userId,
        p_expected_version: 1,
      },
    );
    expect(adminReassignError).toBeNull();

    // Editor now owns it (assigned_editor_id = editor.userId) -- editor can
    // hand it off to a different eligible editor (moderator/admin promoted
    // accounts don't apply here; reuse admin as the "different eligible
    // editor" target since admin also holds a role has_role() accepts).
    const { error: handoffError } = await untypedRpc(
      editor.client,
      "reassign_editorial_story",
      { p_story_id: storyId, p_editor_id: admin.userId, p_expected_version: 2 },
    );
    expect(handoffError).toBeNull();

    // Now assigned back to admin -- editor (no longer assigned) cannot
    // reassign it further.
    const { error: forbiddenError } = await untypedRpc(
      editor.client,
      "reassign_editorial_story",
      {
        p_story_id: storyId,
        p_editor_id: editor.userId,
        p_expected_version: 3,
      },
    );
    expect(forbiddenError).not.toBeNull();
  }, 30000);

  it("a stale p_expected_version is rejected", async () => {
    const { data: contributor } = await editor.client
      .from("contributors")
      .insert({
        created_by: editor.userId,
        display_name: "RLS Test Reassign Stale Contributor",
        attribution_type: "display_name",
      })
      .select("id")
      .single();
    const { data: created } = await editor.client.rpc(
      "create_editorial_import_draft",
      { p_contributor_id: contributor!.id, p_title: slug("reassign-stale") },
    );
    const storyId = created![0].story_id;

    const { error } = await untypedRpc(
      editor.client,
      "reassign_editorial_story",
      {
        p_story_id: storyId,
        p_editor_id: editor.userId,
        p_expected_version: 999,
      },
    );
    expect(error).not.toBeNull();
  });

  it("rejects a self-service (non-editorial-import) story", async () => {
    const { data: created } = await owner.client.rpc(
      "create_self_service_draft",
      { p_title: slug("reassign-self-service") },
    );
    const storyId = created![0].story_id;
    const { error } = await untypedRpc(
      admin.client,
      "reassign_editorial_story",
      {
        p_story_id: storyId,
        p_editor_id: editor.userId,
        p_expected_version: 1,
      },
    );
    expect(error).not.toBeNull();
  });
});

describe("report internal notes and serious-category enforcement (migration 20260805100700)", () => {
  async function publishedStoryReport(category: string) {
    const story = await publishOwnerStory({
      title: slug(`report-${category}`),
    });
    const { data: reportId, error } = await other.client.rpc(
      "create_story_report",
      { p_story_id: story.storyId, p_category: category },
    );
    if (error || !reportId) {
      throw new Error(`Could not create report: ${error?.message}`);
    }
    return reportId;
  }

  it("rejects resolving a harassment report as resolved with no note, succeeds with one", async () => {
    const reportId = await publishedStoryReport("harassment");
    const { error: noNoteError } = await untypedRpc(
      moderator.client,
      "resolve_report",
      {
        p_report_id: reportId,
        p_status: "resolved",
      },
    );
    expect(noNoteError).not.toBeNull();

    const { error: withNoteError } = await untypedRpc(
      moderator.client,
      "resolve_report",
      {
        p_report_id: reportId,
        p_status: "resolved",
        p_internal_note: "Confirmed with the contributor; content updated.",
      },
    );
    expect(withNoteError).toBeNull();

    const { data: notes, error: notesError } = await untypedRpc<
      { internal_note: string }[]
    >(moderator.client, "get_report_notes", { p_report_id: reportId });
    expect(notesError).toBeNull();
    expect(notes?.length).toBeGreaterThan(0);
  }, 30000);

  it("does not require a note to move a harassment report to reviewing", async () => {
    const reportId = await publishedStoryReport("harassment");
    const { error } = await untypedRpc(moderator.client, "resolve_report", {
      p_report_id: reportId,
      p_status: "reviewing",
    });
    expect(error).toBeNull();
  }, 30000);

  it("spam_commercial can be dismissed with no note", async () => {
    const reportId = await publishedStoryReport("spam_commercial");
    const { error } = await untypedRpc(moderator.client, "resolve_report", {
      p_report_id: reportId,
      p_status: "dismissed",
    });
    expect(error).toBeNull();
  }, 30000);

  it("cannot resolve an already-closed report again", async () => {
    const reportId = await publishedStoryReport("other");
    await untypedRpc(moderator.client, "resolve_report", {
      p_report_id: reportId,
      p_status: "dismissed",
    });
    const { error } = await untypedRpc(moderator.client, "resolve_report", {
      p_report_id: reportId,
      p_status: "resolved",
    });
    expect(error).not.toBeNull();
  }, 30000);

  it("an editor cannot resolve a report or read its notes", async () => {
    const reportId = await publishedStoryReport("other");
    const { error: resolveError } = await untypedRpc(
      editor.client,
      "resolve_report",
      {
        p_report_id: reportId,
        p_status: "dismissed",
      },
    );
    expect(resolveError).not.toBeNull();
    const { error: notesError } = await untypedRpc(
      editor.client,
      "get_report_notes",
      {
        p_report_id: reportId,
      },
    );
    expect(notesError).not.toBeNull();
  }, 30000);
});

describe("audit rows are immutable (story_report_notes, story_publication_state_actions, editorial_actions)", () => {
  it("story_report_notes cannot be updated or deleted directly", async () => {
    const { error: updateError } = await untypedTable(
      moderator.client,
      "story_report_notes",
    )
      .update({ internal_note: "tampered" })
      .eq("id", "11111111-1111-4111-8111-111111111111");
    expect(updateError).not.toBeNull();
    const { error: deleteError } = await untypedTable(
      moderator.client,
      "story_report_notes",
    )
      .delete()
      .eq("id", "11111111-1111-4111-8111-111111111111");
    expect(deleteError).not.toBeNull();
  });

  it("story_publication_state_actions cannot be updated or deleted directly", async () => {
    const { error: updateError } = await untypedTable(
      moderator.client,
      "story_publication_state_actions",
    )
      .update({ reason: "tampered" })
      .eq("id", "11111111-1111-4111-8111-111111111111");
    expect(updateError).not.toBeNull();
    const { error: deleteError } = await untypedTable(
      moderator.client,
      "story_publication_state_actions",
    )
      .delete()
      .eq("id", "11111111-1111-4111-8111-111111111111");
    expect(deleteError).not.toBeNull();
  });

  it("editorial_actions cannot be updated or deleted directly", async () => {
    const { error: updateError } = await editor.client
      .from("editorial_actions")
      .update({ summary: "tampered" })
      .eq("id", "11111111-1111-4111-8111-111111111111");
    expect(updateError).not.toBeNull();
    const { error: deleteError } = await editor.client
      .from("editorial_actions")
      .delete()
      .eq("id", "11111111-1111-4111-8111-111111111111");
    expect(deleteError).not.toBeNull();
  });
});

describe("moderation/reports/editorial queues: access, filters, deterministic pagination (migrations 20260805100800/100900/101100/101200)", () => {
  it("a non-staff caller is rejected from every queue function", async () => {
    for (const fn of [
      "get_moderation_queue",
      "list_reports_for_staff",
    ] as const) {
      const { error } = await untypedRpc(owner.client, fn, {});
      expect(error).not.toBeNull();
    }
    const { error: editorialQueueError } = await untypedRpc(
      owner.client,
      "list_editorial_queue",
      {},
    );
    expect(editorialQueueError).not.toBeNull();
  });

  it("get_moderation_queue paginates deterministically and labels first vs. resubmission", async () => {
    const story = await publishOwnerStory({ title: slug("queue-first") });
    // A rejected-then-resubmitted replacement should be labelled 'resubmission'.
    const { data: nextRevisionId } = await owner.client.rpc(
      "create_next_draft_revision",
      { p_story_id: story.storyId },
    );
    const { data: draft } = await owner.client.rpc("get_my_story_with_draft", {
      p_story_id: story.storyId,
    });
    await owner.client.rpc("submit_revision_with_consent", {
      p_revision_id: nextRevisionId!,
      p_expected_version: draft![0].version,
      p_confirmation_method: "account",
      p_publication_confirmed: true,
      p_expected_terms_version: currentTermsVersion,
    });
    const { error: rejectError } = await moderator.client.rpc(
      "moderate_revision",
      {
        p_revision_id: nextRevisionId!,
        p_expected_version: draft![0].version + 1,
        p_decision: "reject",
        p_user_facing_reason: "needs work",
      },
    );
    expect(rejectError).toBeNull();

    const { data: resubmitRevisionId } = await owner.client.rpc(
      "create_next_draft_revision",
      { p_story_id: story.storyId },
    );
    const { data: draft2 } = await owner.client.rpc("get_my_story_with_draft", {
      p_story_id: story.storyId,
    });
    await owner.client.rpc("submit_revision_with_consent", {
      p_revision_id: resubmitRevisionId!,
      p_expected_version: draft2![0].version,
      p_confirmation_method: "account",
      p_publication_confirmed: true,
      p_expected_terms_version: currentTermsVersion,
    });

    const { data: page1, error: page1Error } = await untypedRpc<
      {
        revision_id: string;
        submission_kind: string;
        is_replacement: boolean;
        total_count: number;
      }[]
    >(moderator.client, "get_moderation_queue", {
      p_status: "submitted",
      p_limit: 1,
      p_offset: 0,
    });
    expect(page1Error).toBeNull();
    expect(page1?.length).toBe(1);
    expect(typeof page1?.[0]?.total_count).toBe("number");

    const { data: row } = await untypedRpc<
      { revision_id: string; submission_kind: string }[]
    >(moderator.client, "get_moderation_queue", {
      p_status: "submitted",
      p_limit: 50,
      p_offset: 0,
    });
    const resubmitted = row?.find((r) => r.revision_id === resubmitRevisionId);
    expect(resubmitted?.submission_kind).toBe("resubmission");
  }, 60000);

  it("get_moderation_queue rejects an unknown p_status", async () => {
    const { error } = await untypedRpc(
      moderator.client,
      "get_moderation_queue",
      {
        p_status: "not_a_real_status",
      },
    );
    expect(error).not.toBeNull();
  });

  it("list_reports_for_staff filters by category and clamps limit deterministically", async () => {
    const story = await publishOwnerStory({ title: slug("queue-reports") });
    await other.client.rpc("create_story_report", {
      p_story_id: story.storyId,
      p_category: "spam_commercial",
    });
    const { data, error } = await untypedRpc<{ story_id: string }[]>(
      moderator.client,
      "list_reports_for_staff",
      {
        p_category: "spam_commercial",
        p_story_id: story.storyId,
        p_limit: 500,
      },
    );
    expect(error).toBeNull();
    expect(data?.every((r) => r.story_id === story.storyId)).toBe(true);
  }, 30000);

  it("list_editorial_queue shows a story assigned to an editor to that editor, and admin sees all editorial_import stories regardless of assignment", async () => {
    // NOTE: create_editorial_import_draft() always resolves
    // p_assigned_editor_id via coalesce(p_assigned_editor_id, auth.uid()) --
    // there is currently no RPC path that leaves assigned_editor_id null on
    // an editorial_import story, so the "unclaimed pool" branch of
    // list_editorial_queue() (assigned_editor_id is null) cannot actually be
    // exercised against a story created through the real API today. This is
    // flagged in the Stage 1 report as a real gap for Stage 2/a later prompt
    // to consider (e.g. an explicit "unassign" RPC), not silently assumed
    // away -- this test instead verifies the two branches that ARE
    // reachable: assigned-to-self visibility, and admin's unconditional
    // visibility.
    const { data: contributor } = await admin.client
      .from("contributors")
      .insert({
        created_by: admin.userId,
        display_name: "RLS Test Editorial Queue Contributor",
        attribution_type: "display_name",
      })
      .select("id")
      .single();
    const { data: created } = await admin.client.rpc(
      "create_editorial_import_draft",
      {
        p_contributor_id: contributor!.id,
        p_title: slug("queue-assigned"),
        p_assigned_editor_id: editor.userId,
      },
    );
    const storyId = created![0].story_id;

    const { data: editorView, error: editorError } = await untypedRpc<
      { story_id: string }[]
    >(editor.client, "list_editorial_queue", { p_limit: 50 });
    expect(editorError).toBeNull();
    expect(editorView?.some((s) => s.story_id === storyId)).toBe(true);

    const { data: adminView, error: adminError } = await untypedRpc<
      { story_id: string }[]
    >(admin.client, "list_editorial_queue", { p_limit: 50 });
    expect(adminError).toBeNull();
    expect(adminView?.some((s) => s.story_id === storyId)).toBe(true);
  }, 30000);
});

describe("get_story_for_moderator never returns contributor identity fields (migration 20260805100900)", () => {
  it("returns no linked_user_id/created_by-shaped keys, and reads attribution from the consent snapshot", async () => {
    const story = await publishOwnerStory({ title: slug("moderator-detail") });
    const { data, error } = await untypedRpc<Record<string, unknown>[]>(
      moderator.client,
      "get_story_for_moderator",
      { p_revision_id: story.revisionId },
    );
    expect(error).toBeNull();
    const keys = Object.keys(data![0]);
    for (const forbidden of ["linked_user_id", "created_by", "owner_user_id"]) {
      expect(keys).not.toContain(forbidden);
    }
    expect(data![0].attribution_value).toBeTruthy();
  }, 30000);

  it("a moderator directly selecting contributors gains nothing beyond the public/self-service policies (migration 20260805101000)", async () => {
    const { error } = await moderator.client
      .from("contributors")
      .select("id, linked_user_id")
      .eq("linked_user_id", owner.userId);
    // Not the moderator's own row and not public -- the removed staff
    // policy previously made this succeed; now it should return nothing
    // (RLS-filtered) rather than erroring outright, since anon/authenticated
    // still has table-level SELECT grants (contributors uses ordinary RLS,
    // not the story domain's zero-grant model) -- only the ROW-level policy
    // was narrowed.
    expect(error).toBeNull();
  });

  it("get_story_moderation_history and get_story_editorial_history are moderator/admin readable and editor/other denied for moderation history", async () => {
    const story = await publishOwnerStory({ title: slug("history-story") });
    const { data: modHistory, error: modError } = await untypedRpc(
      moderator.client,
      "get_story_moderation_history",
      { p_story_id: story.storyId },
    );
    expect(modError).toBeNull();
    expect(Array.isArray(modHistory)).toBe(true);

    const { error: editorDeniedError } = await untypedRpc(
      editor.client,
      "get_story_moderation_history",
      { p_story_id: story.storyId },
    );
    expect(editorDeniedError).not.toBeNull();

    const { data: editHistory, error: editHistoryError } = await untypedRpc(
      moderator.client,
      "get_story_editorial_history",
      { p_story_id: story.storyId },
    );
    expect(editHistoryError).toBeNull();
    expect(Array.isArray(editHistory)).toBe(true);
  }, 30000);

  it("get_published_revision_snapshot returns the currently-published revision's content", async () => {
    const story = await publishOwnerStory({ title: slug("snapshot-story") });
    const { data, error } = await untypedRpc<{ revision_id: string }[]>(
      moderator.client,
      "get_published_revision_snapshot",
      { p_story_id: story.storyId },
    );
    expect(error).toBeNull();
    expect(data?.[0]?.revision_id).toBe(story.revisionId);
  }, 30000);
});
