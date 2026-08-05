import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Prompt 7: the "critical founding-catalogue workflow" acceptance criterion
 * -- an editor takes an existing written story from draft import through
 * contributor approval and moderation, using only fictional data (Engineering
 * Rule 22), and the resulting story shows up correctly in /readiness.
 *
 * Fixture creation follows the same established pattern as
 * e2e/moderation.spec.ts (direct RPC calls through a signed-in
 * @supabase/supabase-js client, not a UI-driven "type the whole story"
 * fixture) -- Playwright itself is reserved for the actual page/Server-Action
 * behavior under test: the editor's import UI, the contributor's own
 * approve action, the moderator's approve action, and the readiness
 * dashboard reading the result back.
 *
 * RUN AND PASSING against the live linked project, with `--workers=1` (same
 * reasoning as e2e/moderation.spec.ts -- this shares the same live queues):
 *
 *   node --env-file=.env.test.local node_modules/.bin/playwright test \
 *     e2e/founding-story-workflow.spec.ts --workers=1
 *
 * Fixture hygiene: every fixture title/slug uses a leading `rls-test` token
 * so it falls inside scripts/rls-test-cleanup.sql's existing
 * `slug like 'rls-test-%'` scope -- no new cleanup script needed.
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

const hasAllCredentials = Boolean(
  URL &&
  KEY &&
  OWNER_EMAIL &&
  OWNER_PASSWORD &&
  EDITOR_EMAIL &&
  EDITOR_PASSWORD &&
  MODERATOR_EMAIL &&
  MODERATOR_PASSWORD,
);

async function signInRpcClient(
  email: string,
  password: string,
): Promise<SupabaseClient> {
  const client = createClient(URL!, KEY!);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

async function signInUi(page: Page, email: string, password: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"));
}

test.describe("founding-catalogue workflow (real UI, real hosted project, fictional data only)", () => {
  test.skip(
    !hasAllCredentials,
    "Requires the SUPABASE_RLS_TEST_* pool (owner/editor/moderator) in .env.test.local — see docs/architecture.md 'RLS integration test setup'.",
  );

  test("editor import -> contributor approval -> moderation -> readiness dashboard", async ({
    page,
  }) => {
    const runId = Math.random().toString(36).slice(2, 8);
    const title = `rls-test founding story ${runId}`;

    // 1. The owner test account's OWN contributor record stands in for a
    // founding-catalogue contributor who already has an account -- reusing
    // the fixed pool account rather than creating a throwaway auth user, same
    // convention as every other RLS-suite/e2e fixture in this repo.
    const owner = await signInRpcClient(OWNER_EMAIL!, OWNER_PASSWORD!);
    const ownerUserId = (await owner.auth.getUser()).data.user?.id;
    const { data: ownerContributor, error: contributorLookupError } =
      await owner
        .from("contributors")
        .select("id")
        .eq("linked_user_id", ownerUserId)
        .single();
    if (contributorLookupError || !ownerContributor) {
      throw new Error(
        `owner contributor lookup failed: ${contributorLookupError?.message ?? "no row"}`,
      );
    }

    // 2. Editor creates the editorial import draft against that contributor.
    const editor = await signInRpcClient(EDITOR_EMAIL!, EDITOR_PASSWORD!);
    const { data: importDraft, error: importError } = await editor.rpc(
      "create_editorial_import_draft",
      { p_contributor_id: ownerContributor.id, p_title: title },
    );
    if (importError || !importDraft?.[0]) {
      throw new Error(
        `create_editorial_import_draft failed: ${importError?.message ?? "no data"}`,
      );
    }
    const storyId: string = importDraft[0].story_id ?? importDraft[0].id;
    const revisionId: string = importDraft[0].revision_id;

    // 3. Editor fills in real content via the RPC layer (equivalent to
    // pasting through the import panel and saving) so the draft is genuinely
    // submittable.
    const { error: saveError } = await editor.rpc("save_revision_draft", {
      p_revision_id: revisionId,
      p_expected_version: 1,
      p_title: title,
      p_excerpt: "A fictional founding-catalogue fixture story.",
      p_content_json: [
        {
          type: "paragraph",
          text: [
            {
              text: "This is a fictional fixture story used only for automated testing.",
            },
          ],
        },
      ],
    });
    if (saveError)
      throw new Error(`save_revision_draft failed: ${saveError.message}`);

    // 4. Editor marks the draft ready for contributor review, through the
    // real UI (app/(editor)/editorial/[id]/editorial-controls.tsx).
    await signInUi(page, EDITOR_EMAIL!, EDITOR_PASSWORD!);
    await page.goto(`/editorial/${storyId}/edit`);
    await page
      .getByRole("button", { name: "Mark ready for contributor review" })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Sent to the contributor for review.",
      { timeout: 10000 },
    );

    // 5. The linked contributor (the owner test account) reviews and
    // approves through the real UI (components/story/contributor-review-panel.tsx
    // + the "what's public" summary above it).
    const contributorPage = await page.context().browser()!.newContext();
    const reviewPage = await contributorPage.newPage();
    await signInUi(reviewPage, OWNER_EMAIL!, OWNER_PASSWORD!);
    await reviewPage.goto(`/stories/${storyId}/preview`);
    await expect(
      reviewPage.getByRole("heading", { name: "What will be public" }),
    ).toBeVisible();
    await reviewPage.getByRole("button", { name: "Approve" }).click();
    await reviewPage
      .getByLabel(/I confirm I have the right to publish/)
      .check();
    // This story is an editorial import, so submit-consent-panel.tsx also
    // requires this second checkbox -- easy to miss since it only renders
    // when isEditorialImport, unlike the self-service path.
    await reviewPage
      .getByLabel(/I've reviewed this editor-prepared version/)
      .check();
    await reviewPage
      .getByRole("button", { name: "Approve & submit for moderation" })
      .click();
    await expect(reviewPage.getByRole("status")).toBeVisible({
      timeout: 10000,
    });
    await contributorPage.close();

    // 6. Moderator approves through the real moderation review UI.
    const moderatorContext = await page.context().browser()!.newContext();
    const moderatorPage = await moderatorContext.newPage();
    await signInUi(moderatorPage, MODERATOR_EMAIL!, MODERATOR_PASSWORD!);
    await moderatorPage.goto(`/moderation/stories/${revisionId}`);
    await moderatorPage
      .getByRole("button", { name: "Approve and publish" })
      .click();
    await expect(moderatorPage.getByRole("status")).toContainText(
      "Story approved and published",
      { timeout: 20000 },
    );
    await moderatorContext.close();

    // 7. The readiness dashboard reflects the finished workflow: published,
    // consent complete, editorial review complete.
    await page.goto(`/readiness?lifecycleStatus=published`);
    const readinessRow = page.locator("li", { hasText: title });
    await expect(readinessRow).toBeVisible({ timeout: 10000 });
    await expect(readinessRow.getByText("✓ Publication consent")).toBeVisible();
    await expect(readinessRow.getByText("✓ Editorial review")).toBeVisible();
  });
});
