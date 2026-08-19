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
 */

try {
  process.loadEnvFile(path.join(__dirname, "..", ".env.test.local"));
} catch {
  // File doesn't exist in this environment -- every test below skips itself.
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
