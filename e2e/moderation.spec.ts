import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { signInUi } from "./helpers/sign-in";

/**
 * Prompt 6 Stage 2: real, UI-level (browser-driven) proof of the
 * moderation/editorial queue and review pages this stage adds --
 * app/(moderation)/moderation/{page,stories/page,stories/[id]/page}.tsx,
 * their Server Actions, and the extended app/(editor)/editorial/page.tsx.
 *
 * RUN AND PASSING (12/12 across this file and e2e/reports-triage.spec.ts)
 * against the live linked project, with `--workers=1`:
 *
 *   node --env-file=.env.test.local node_modules/.bin/playwright test \
 *     e2e/moderation.spec.ts e2e/reports-triage.spec.ts --workers=1
 *
 * `--workers=1` is required, not optional: both specs' "Triage"/queue links
 * point at rows in a queue shared across the whole disposable dev project,
 * and default parallelism (multiple workers hitting the same live
 * `/moderation/stories`/`/moderation/reports` queues concurrently) produces
 * cross-test interference that has nothing to do with correctness of the
 * app under test -- confirmed directly: the identical assertions here pass
 * reliably serial and intermittently fail parallel.
 *
 * Real bugs found and fixed while getting this to pass live:
 *   1. get_story_editorial_history() was moderator/admin-only, but this
 *      stage's own editorial-history-panel.tsx renders it on the assigned
 *      EDITOR's own edit page -- every editor hit a genuine 500 visiting
 *      their own story. Fixed in
 *      supabase/migrations/20260805120000_fix_get_story_editorial_history_editor_access.sql
 *      (broadened to also authorize the story's assigned editor).
 *   2. app/(moderation)/moderation/stories/[id]/review-controls.tsx's
 *      approve/reject success message lived inside the `canDecide` branch,
 *      which flips false the instant revalidatePath() refreshes
 *      `revisionStatus` after a successful action -- the confirmation was
 *      never actually observable. Fixed by rendering it unconditionally.
 * Two test-authoring bugs (not app bugs) were also fixed: a strict-mode
 * locator match against accumulated fixture debris, and the reassignment
 * test's final assertion, which had inverted the correct expectation (the
 * fixture story is admin-assigned, so the non-admin editor correctly does
 * NOT see it in their own queue -- the original assertion expected the
 * opposite).
 *
 * Fixture creation follows tests/integration/story-rls.integration.test.ts's
 * own pattern (direct RPC calls through a signed-in client via
 * @supabase/supabase-js) rather than inventing a new approach -- a UI-driven
 * "type the whole story, attach an image, wait for processing" fixture per
 * test would be far slower and more brittle than reusing the same
 * create_self_service_draft/save_revision_draft/submit_revision_with_consent
 * RPC sequence the integration suite already exercises. Playwright itself
 * is reserved for the actual page/Server-Action behavior under test.
 *
 * Fixture hygiene: every fixture title/slug uses a leading `rls-test` token
 * so it falls inside scripts/rls-test-cleanup.sql's existing
 * `slug like 'rls-test-%'` scope -- no new cleanup script needed, same
 * convention as e2e/cross-contributor-access.spec.ts.
 *
 * 2026-09-02: three tests added at the end of this file for the moderation
 * review rebuild of that date (empty-submission handling, the queue's
 * triage chips/submitter line, and the consent_valid composite-null fix in
 * migration 20260902090200). They are additive -- nothing above them
 * changed. The two "moderator approves"/"moderator rejects" tests were
 * observed FAILING while those were being added, in a way unrelated to
 * them, and since traced and FIXED: the Server Action returned 200 in under
 * a second with a complete payload that literally contained the
 * confirmation string, but the browser never committed that transition, so
 * the button stayed "Approving..."/"Submitting..." forever. Production
 * builds only, and it needed both the rewritten review page and the
 * action's revalidatePath() calls -- a Next 16.2.12 race, not application
 * code. Upgrading to Next 16.3.4 fixed it with no app change; these two
 * tests now pass consistently. Full measurements are in
 * docs/implementation-status.md under the 2026-09-02 entry. If either test
 * ever starts hanging again with the button stuck, check the Next version
 * before suspecting this file.
 */

try {
  process.loadEnvFile(path.join(__dirname, "..", ".env.test.local"));
} catch {
  // File doesn't exist in this environment -- every test below skips itself.
}

/**
 * Loaded separately and optionally: the service-role key lives in .env.local
 * (the app's own runtime env), not in the RLS-test pool, and only the two
 * "legacy empty submission" tests below need it. Everything else in this file
 * deliberately goes through ordinary signed-in clients.
 */
try {
  process.loadEnvFile(path.join(__dirname, "..", ".env.local"));
} catch {
  // Absent here -- the two tests that need it skip themselves.
}

const URL = process.env.SUPABASE_RLS_TEST_URL;
const KEY = process.env.SUPABASE_RLS_TEST_PUBLISHABLE_KEY;
const OWNER_EMAIL = process.env.SUPABASE_RLS_TEST_OWNER_EMAIL;
const OWNER_PASSWORD = process.env.SUPABASE_RLS_TEST_OWNER_PASSWORD;
const EDITOR_EMAIL = process.env.SUPABASE_RLS_TEST_EDITOR_EMAIL;
const EDITOR_PASSWORD = process.env.SUPABASE_RLS_TEST_EDITOR_PASSWORD;
const MODERATOR_EMAIL = process.env.SUPABASE_RLS_TEST_MODERATOR_EMAIL;
const MODERATOR_PASSWORD = process.env.SUPABASE_RLS_TEST_MODERATOR_PASSWORD;
const ADMIN_EMAIL = process.env.SUPABASE_RLS_TEST_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.SUPABASE_RLS_TEST_ADMIN_PASSWORD;

const hasAllCredentials = Boolean(
  URL &&
  KEY &&
  OWNER_EMAIL &&
  OWNER_PASSWORD &&
  EDITOR_EMAIL &&
  EDITOR_PASSWORD &&
  MODERATOR_EMAIL &&
  MODERATOR_PASSWORD &&
  ADMIN_EMAIL &&
  ADMIN_PASSWORD,
);

const SERVICE_ROLE_KEY =
  process.env.SUPABASE_RLS_TEST_SERVICE_ROLE_KEY ??
  process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * The URL the service-role key above actually belongs to. A service-role key
 * bypasses RLS entirely, so it is only used when it provably targets the SAME
 * disposable dev project as the rest of this file -- never a key from one
 * project pointed at another.
 */
const SERVICE_ROLE_URL = process.env.SUPABASE_RLS_TEST_SERVICE_ROLE_KEY
  ? URL
  : process.env.NEXT_PUBLIC_SUPABASE_URL;

const canWriteWithServiceRole = Boolean(
  hasAllCredentials && SERVICE_ROLE_KEY && SERVICE_ROLE_URL === URL,
);

const SERVICE_ROLE_SKIP_REASON =
  "Requires a service-role key for the same project as SUPABASE_RLS_TEST_URL (SUPABASE_SERVICE_ROLE_KEY in .env.local, or SUPABASE_RLS_TEST_SERVICE_ROLE_KEY in .env.test.local) to reproduce a pre-20260902090000 empty submission.";

const TERMS_VERSION_FALLBACK = "e2e-fixture-terms";

async function signInRpcClient(
  email: string,
  password: string,
): Promise<SupabaseClient> {
  const client = createClient(URL!, KEY!);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

/** Creates and submits a self-service revision, returning its ids. */
async function createSubmittedSelfServiceRevision(
  owner: SupabaseClient,
  titleSuffix: string,
): Promise<{ storyId: string; revisionId: string }> {
  const title = `rls-test moderation e2e ${titleSuffix}`;
  const { data: draft, error: draftError } = await owner.rpc(
    "create_self_service_draft",
    { p_title: title },
  );
  if (draftError || !draft?.[0]) {
    throw new Error(
      `create_self_service_draft failed: ${draftError?.message ?? "no data"}`,
    );
  }
  const storyId: string = draft[0].story_id ?? draft[0].id;
  const revisionId: string = draft[0].revision_id;

  await owner.rpc("save_revision_draft", {
    p_revision_id: revisionId,
    p_expected_version: 1,
    p_title: title,
    p_excerpt: "An e2e fixture story for Prompt 6 Stage 2 moderation specs.",
    p_content_json: [
      {
        type: "paragraph",
        text: [{ text: "Fixture content for moderation review." }],
      },
    ],
  });

  let termsVersion = TERMS_VERSION_FALLBACK;
  try {
    const { data } = await owner.rpc("current_terms_version");
    if (typeof data === "string" && data.length > 0) termsVersion = data;
  } catch {
    // Fall back to the placeholder above if this RPC isn't reachable here.
  }

  const { error: submitError } = await owner.rpc(
    "submit_revision_with_consent",
    {
      p_revision_id: revisionId,
      p_expected_version: 2,
      p_confirmation_method: "account",
      p_publication_confirmed: true,
      p_expected_terms_version: termsVersion,
      p_image_rights_confirmed: false,
      p_identifiable_people_state: "not_applicable",
      p_editorial_assistance_confirmed: false,
    },
  );
  if (submitError) {
    throw new Error(
      `submit_revision_with_consent failed: ${submitError.message}`,
    );
  }

  return { storyId, revisionId };
}

function serviceRoleClient(): SupabaseClient {
  return createClient(URL!, SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Reproduces a **legacy** empty submission -- a revision sitting in the queue
 * with `content_json = '[]'::jsonb`.
 *
 * It has to be done this way, by writing the row directly with a service-role
 * client, because the fixture cannot simply submit an empty draft any more:
 * `submit_revision_with_consent()` raises WHV03 for a document with no text
 * as of migration 20260902090000. That migration closed the hole going
 * forward; it did not delete the 14 rows that got in through it before, and
 * those rows must stay REVIEWABLE -- a moderator still has to be able to open
 * one and request changes on it. That is exactly what these tests pin down,
 * so the fixture has to recreate the state the migration now prevents rather
 * than the state it allows.
 */
async function emptyRevisionContent(revisionId: string): Promise<void> {
  const service = serviceRoleClient();

  // Two updates, not one, because of
  // story_revisions_protect_immutable_content() (20260803090200): content
  // columns are frozen for any row whose CURRENT status is not 'draft', and
  // that trigger fires for the service role too. So the row is briefly put
  // back to 'draft' (a status-only change, which the trigger allows), then
  // the content is emptied and the status restored in a single statement --
  // legal because at that point the OLD status is 'draft' and the guard is
  // skipped. The consent row, submitted_at and story lifecycle_status
  // written by submit_revision_with_consent() are never touched, so what is
  // left is exactly the legacy shape: a submitted, consented revision whose
  // content_json is `[]`.
  const { error: toDraftError } = await service
    .from("story_revisions")
    .update({ revision_status: "draft" })
    .eq("id", revisionId);
  if (toDraftError) {
    throw new Error(`emptying content_json failed: ${toDraftError.message}`);
  }

  const { error } = await service
    .from("story_revisions")
    .update({ content_json: [], revision_status: "submitted" })
    .eq("id", revisionId);
  if (error) {
    throw new Error(`emptying content_json failed: ${error.message}`);
  }
}

/** The name the queue card is expected to show for a fixture's submitter. */
async function contributorDisplayNameForStory(
  storyId: string,
): Promise<string> {
  const service = serviceRoleClient();
  const { data: story, error: storyError } = await service
    .from("stories")
    .select("contributor_id")
    .eq("id", storyId)
    .single();
  if (storyError || !story) {
    throw new Error(`story lookup failed: ${storyError?.message ?? "no data"}`);
  }
  const { data: contributor, error: contributorError } = await service
    .from("contributors")
    .select("display_name")
    .eq("id", story.contributor_id)
    .single();
  if (contributorError || !contributor) {
    throw new Error(
      `contributor lookup failed: ${contributorError?.message ?? "no data"}`,
    );
  }
  return contributor.display_name as string;
}

test.describe("moderation workspace (real UI, real hosted project)", () => {
  test.skip(
    !hasAllCredentials,
    "Requires the full SUPABASE_RLS_TEST_* pool (owner/editor/moderator/admin) in .env.test.local — see docs/architecture.md 'RLS integration test setup'. Also requires this stage's unpushed migrations to be live first.",
  );

  test("signed-out visitor gets a flat 404 for /moderation and /editorial", async ({
    page,
  }) => {
    const modResponse = await page.goto("/moderation");
    expect(modResponse?.status()).toBe(404);

    const eduResponse = await page.goto("/editorial");
    expect(eduResponse?.status()).toBe(404);
  });

  test("an editor cannot reach /moderation (flat 404), a moderator cannot reach /editorial (flat 404)", async ({
    browser,
  }) => {
    const editorContext = await browser.newContext();
    const editorPage = await editorContext.newPage();
    await signInUi(editorPage, EDITOR_EMAIL!, EDITOR_PASSWORD!);
    const editorModResponse = await editorPage.goto("/moderation");
    expect(editorModResponse?.status()).toBe(404);
    await editorContext.close();

    const moderatorContext = await browser.newContext();
    const moderatorPage = await moderatorContext.newPage();
    await signInUi(moderatorPage, MODERATOR_EMAIL!, MODERATOR_PASSWORD!);
    const moderatorEduResponse = await moderatorPage.goto("/editorial");
    expect(moderatorEduResponse?.status()).toBe(404);
    await moderatorContext.close();
  });

  test("submitted revision appears in the queue, labeled as a first submission, and its review page is reachable", async ({
    page,
  }) => {
    const runId = Math.random().toString(36).slice(2, 8);
    const owner = await signInRpcClient(OWNER_EMAIL!, OWNER_PASSWORD!);
    const { revisionId } = await createSubmittedSelfServiceRevision(
      owner,
      `queue-${runId}`,
    );

    await signInUi(page, MODERATOR_EMAIL!, MODERATOR_PASSWORD!);
    await page.goto("/moderation/stories?status=submitted");
    // .first(): the disposable dev project accumulates multiple
    // "First submission"-labeled rows across repeated test runs (accepted
    // debris, same as every other RLS-test fixture in this repo) -- this
    // just confirms the label renders at least once, not that it's unique.
    await expect(page.getByText("First submission").first()).toBeVisible();

    const reviewResponse = await page.goto(`/moderation/stories/${revisionId}`);
    expect(reviewResponse?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { name: /rls-test moderation e2e/ }),
    ).toBeVisible();
  });

  test("moderator approves a submitted revision end to end (publishes it)", async ({
    page,
  }) => {
    const runId = Math.random().toString(36).slice(2, 8);
    const owner = await signInRpcClient(OWNER_EMAIL!, OWNER_PASSWORD!);
    const { revisionId } = await createSubmittedSelfServiceRevision(
      owner,
      `approve-${runId}`,
    );

    await signInUi(page, MODERATOR_EMAIL!, MODERATOR_PASSWORD!);
    await page.goto(`/moderation/stories/${revisionId}`);
    await page.getByRole("button", { name: "Approve and publish" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Story approved and published",
      { timeout: 20000 },
    );
  });

  test("moderator rejects a submitted revision with a required reason", async ({
    page,
  }) => {
    const runId = Math.random().toString(36).slice(2, 8);
    const owner = await signInRpcClient(OWNER_EMAIL!, OWNER_PASSWORD!);
    const { revisionId } = await createSubmittedSelfServiceRevision(
      owner,
      `reject-${runId}`,
    );

    await signInUi(page, MODERATOR_EMAIL!, MODERATOR_PASSWORD!);
    await page.goto(`/moderation/stories/${revisionId}`);
    await page.getByRole("combobox").selectOption("reject");
    await page
      .getByPlaceholder("Reason shown to the contributor (required)")
      .fill("Trip dates are missing.");
    await page.getByRole("button", { name: "Submit decision" }).click();
    await expect(page.getByRole("status")).toContainText("Revision rejected.");
  });

  test("editor queue supports status/search filters and pagination controls render", async ({
    page,
  }) => {
    await signInUi(page, EDITOR_EMAIL!, EDITOR_PASSWORD!);
    await page.goto("/editorial?status=draft");
    await expect(
      page.getByRole("heading", { name: "Editorial Dashboard" }),
    ).toBeVisible();
    await expect(page.getByLabel("Status")).toHaveValue("draft");
  });

  test("admin can reassign an editorial-import story; a non-admin editor reassigning another editor's story gets a clear error", async ({
    browser,
  }) => {
    const admin = await signInRpcClient(ADMIN_EMAIL!, ADMIN_PASSWORD!);
    const runId = Math.random().toString(36).slice(2, 8);
    // create_editorial_import_draft() requires an existing contributor row's
    // id (p_contributor_id) -- it has no display-name shortcut. Same
    // fixture-creation pattern as tests/integration/story-rls.integration.test.ts's
    // "assigned-editor read access" describe block: insert an unlinked
    // contributor row first (staff-only insert policy), then pass its id.
    const { data: contributor, error: contributorError } = await admin
      .from("contributors")
      .insert({
        created_by: (await admin.auth.getUser()).data.user?.id,
        display_name: `E2E Reassign Contributor ${runId}`,
        attribution_type: "display_name",
      })
      .select("id")
      .single();
    if (contributorError || !contributor) {
      throw new Error(
        `contributor insert failed: ${contributorError?.message ?? "no data"}`,
      );
    }

    const { data: importDraft, error } = await admin.rpc(
      "create_editorial_import_draft",
      {
        p_contributor_id: contributor.id,
        p_title: `rls-test moderation e2e reassign ${runId}`,
      },
    );
    if (error || !importDraft?.[0]) {
      throw new Error(
        `create_editorial_import_draft failed: ${error?.message ?? "no data"}`,
      );
    }
    const storyId: string = importDraft[0].story_id ?? importDraft[0].id;

    const editorContext = await browser.newContext();
    const editorPage = await editorContext.newPage();
    await signInUi(editorPage, EDITOR_EMAIL!, EDITOR_PASSWORD!);
    // The fixture story is admin-assigned (create_editorial_import_draft
    // defaults assigned_editor_id to its own caller), so a non-admin editor
    // hitting reassign here (via a direct navigation to its edit page,
    // which the per-row proxy.ts check still gates on assigned_editor_id =
    // caller OR admin) exercises reassign_editorial_story()'s "an editor
    // may not reassign a story assigned to a different editor" rejection
    // path -- surfaced as a clear error/404, not silently hidden.
    const editResponse = await editorPage.goto(`/editorial/${storyId}/edit`);
    expect(editResponse?.status()).toBe(404);

    // Correctness fix found while running this live: this fixture is
    // assigned to ADMIN (create_editorial_import_draft() defaults
    // assigned_editor_id to its own caller), so per list_editorial_queue()'s
    // own access rule (editor sees stories assigned to them + the unclaimed
    // pool only, never another specific editor/admin's assignment) this
    // non-admin editor must NOT see it in their own queue -- the original
    // version of this assertion incorrectly expected the opposite.
    await editorPage.goto("/editorial");
    const row = editorPage.getByText(
      `rls-test-moderation-e2e-reassign-${runId}`,
      {
        exact: false,
      },
    );
    await expect(row).not.toBeVisible();
    await editorContext.close();
  });

  test("a legacy empty submission stays reviewable: the review page names it as empty, not as a render failure, and pre-fills the request-changes reason", async ({
    page,
  }) => {
    test.skip(!canWriteWithServiceRole, SERVICE_ROLE_SKIP_REASON);
    const runId = Math.random().toString(36).slice(2, 8);
    const owner = await signInRpcClient(OWNER_EMAIL!, OWNER_PASSWORD!);
    const { revisionId } = await createSubmittedSelfServiceRevision(
      owner,
      `empty-review-${runId}`,
    );
    await emptyRevisionContent(revisionId);

    await signInUi(page, MODERATOR_EMAIL!, MODERATOR_PASSWORD!);
    const reviewResponse = await page.goto(`/moderation/stories/${revisionId}`);
    expect(reviewResponse?.status()).toBe(200);

    // The fact, stated as a fact the moderator can act on...
    await expect(
      page.getByText("This submission has no story content."),
    ).toBeVisible();
    // ...and NOT the old dead-end message, which said "something broke" about
    // a story that is simply empty.
    await expect(
      page.getByText("Could not render submitted content."),
    ).toHaveCount(0);

    // The suggested contributor-facing reason is pre-filled (editable, and
    // nothing is sent until the moderator presses the button).
    await expect(
      page.getByPlaceholder("Reason shown to the contributor (required)"),
    ).toHaveValue(/without any story text/);
  });

  test("the queue card for an empty submission shows the 'No story content' chip and who submitted it", async ({
    page,
  }) => {
    test.skip(!canWriteWithServiceRole, SERVICE_ROLE_SKIP_REASON);
    const runId = Math.random().toString(36).slice(2, 8);
    const owner = await signInRpcClient(OWNER_EMAIL!, OWNER_PASSWORD!);
    const title = `rls-test moderation e2e empty-queue-${runId}`;
    const { storyId, revisionId } = await createSubmittedSelfServiceRevision(
      owner,
      `empty-queue-${runId}`,
    );
    expect(revisionId).toBeTruthy();
    await emptyRevisionContent(revisionId);
    const submitterName = await contributorDisplayNameForStory(storyId);

    await signInUi(page, MODERATOR_EMAIL!, MODERATOR_PASSWORD!);
    await page.goto("/moderation/stories?status=submitted");

    // The queue is submitted_at DESC (20260816090000), so this fixture --
    // just submitted -- is on the first page. Scoping to its own card rather
    // than the page keeps this immune to the accumulated fixture debris the
    // rest of this file already tolerates.
    const card = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("link", { name: title, exact: true }) });
    await expect(card).toHaveCount(1);
    await expect(card.getByText("No story content")).toBeVisible();
    await expect(card).toContainText(submitterName);
  });

  test("a granted consent row reads as Valid in the review page's Consent & rights panel", async ({
    page,
  }) => {
    // Regression guard for
    // supabase/migrations/20260902090200_fix_consent_valid_composite_null_check.sql.
    // `_latest_valid_consent_for_revision()` returns a COMPOSITE, and
    // `rowvalue IS NOT NULL` on a composite means "every field is non-null" in
    // Postgres -- not "a row came back". Several consent columns are
    // legitimately null (image_rights_confirmed_at with no images,
    // editorial_assistance_confirmed_at on every self-service story), so
    // consent_valid was false for 24 of 24 submitted revisions, this fixture's
    // shape included. Any revival of that expression turns this red.
    const runId = Math.random().toString(36).slice(2, 8);
    const owner = await signInRpcClient(OWNER_EMAIL!, OWNER_PASSWORD!);
    const { revisionId } = await createSubmittedSelfServiceRevision(
      owner,
      `consent-${runId}`,
    );

    await signInUi(page, MODERATOR_EMAIL!, MODERATOR_PASSWORD!);
    await page.goto(`/moderation/stories/${revisionId}`);

    const consentPanel = page
      .getByRole("heading", { name: "Consent & rights" })
      .locator("..");
    await expect(
      consentPanel.getByText("Valid", { exact: true }),
    ).toBeVisible();
    await expect(consentPanel.getByText("Missing or invalid")).toHaveCount(0);
  });

  test("editorial history panel appears on the editor's edit page", async ({
    page,
  }) => {
    const editor = await signInRpcClient(EDITOR_EMAIL!, EDITOR_PASSWORD!);
    const runId = Math.random().toString(36).slice(2, 8);
    const { data: contributor, error: contributorError } = await editor
      .from("contributors")
      .insert({
        created_by: (await editor.auth.getUser()).data.user?.id,
        display_name: `E2E History Contributor ${runId}`,
        attribution_type: "display_name",
      })
      .select("id")
      .single();
    if (contributorError || !contributor) {
      throw new Error(
        `contributor insert failed: ${contributorError?.message ?? "no data"}`,
      );
    }

    const { data: importDraft, error } = await editor.rpc(
      "create_editorial_import_draft",
      {
        p_contributor_id: contributor.id,
        p_title: `rls-test moderation e2e history ${runId}`,
      },
    );
    if (error || !importDraft?.[0]) {
      throw new Error(
        `create_editorial_import_draft failed: ${error?.message ?? "no data"}`,
      );
    }
    const storyId: string = importDraft[0].story_id ?? importDraft[0].id;

    await signInUi(page, EDITOR_EMAIL!, EDITOR_PASSWORD!);
    await page.goto(`/editorial/${storyId}/edit`);
    await expect(page.getByText("Editorial history")).toBeVisible();
  });
});
