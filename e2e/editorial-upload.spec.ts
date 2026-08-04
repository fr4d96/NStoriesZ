import path from "node:path";
import { test, expect } from "@playwright/test";

/**
 * Real, end-to-end proof of the multipart upload Route Handler
 * (app/(contributor)/stories/[id]/edit/upload/route.ts) exercised by a
 * signed-in editor through the actual editorial UI -- not mocked, not
 * unit-tested. Uses the deterministic, committed
 * tests/integration/fixtures/tiny.png fixture (a genuinely tiny, valid
 * PNG, generated once via sharp and committed as binary) rather than a
 * generated-at-runtime file, so a failure is reproducible byte-for-byte.
 *
 * Requires the SAME fixed editor test account `npm run test:rls` uses
 * (see docs/architecture.md "RLS integration test setup") -- loaded from
 * .env.test.local, which is never committed. Skips itself (not a hard
 * failure) if that file/credentials aren't present, since this spec needs
 * a real account on the real linked hosted project, unlike the rest of
 * e2e/, which only ever exercises public/signed-out routes.
 *
 * This spec's core dependency -- get_my_story_with_draft() authorizing the
 * story's assigned editor, not just its owner/linked contributor -- is
 * Prompt 4 Sub-phase 4 migration 20260804092000_assigned_editor_can_read_draft.sql,
 * later corrected by 20260804092500_fix_get_my_story_with_draft_ambiguous_column.sql
 * (the first version raised a live Postgres 42702 ambiguous-column error).
 * Both are now pushed to the hosted project and this spec passes end to
 * end -- see docs/implementation-status.md "Prompt 4 Sub-phase 4" for the
 * full migration history.
 */

try {
  process.loadEnvFile(path.join(__dirname, "..", ".env.test.local"));
} catch {
  // File doesn't exist in this environment -- the test below skips itself.
}

const EDITOR_EMAIL = process.env.SUPABASE_RLS_TEST_EDITOR_EMAIL;
const EDITOR_PASSWORD = process.env.SUPABASE_RLS_TEST_EDITOR_PASSWORD;
const hasEditorCredentials = Boolean(EDITOR_EMAIL && EDITOR_PASSWORD);

const FIXTURE_PATH = path.join(
  __dirname,
  "..",
  "tests",
  "integration",
  "fixtures",
  "tiny.png",
);

test.describe("editorial image upload (real Route Handler, real hosted project)", () => {
  test.skip(
    !hasEditorCredentials,
    "Requires SUPABASE_RLS_TEST_EDITOR_EMAIL/PASSWORD in .env.test.local — see docs/architecture.md 'RLS integration test setup'.",
  );

  test("editor creates an editorial import, uploads tiny.png, and it reaches processed", async ({
    page,
  }) => {
    const runId = Math.random().toString(36).slice(2, 8);

    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(EDITOR_EMAIL!);
    await page.getByLabel("Password").fill(EDITOR_PASSWORD!);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"));

    await page.goto("/editorial/new");
    await page.getByLabel("Title").fill(`e2e-editorial-upload-${runId}`);
    await page.getByLabel("New (unlinked) contributor").check();
    await page
      .getByLabel("Display name")
      .fill(`E2E Editorial Contributor ${runId}`);
    await page.getByRole("button", { name: "Create Import Draft" }).click();

    await page.waitForURL(/\/editorial\/[^/]+\/edit$/, { timeout: 15000 });

    const fileInput = page.locator("#story-image-upload");
    await fileInput.setInputFiles(FIXTURE_PATH);

    // processStoryMedia() runs synchronously inside the upload request
    // (no background worker in this phase — see docs/architecture.md
    // "Upload reservation flow"), so by the time the request resolves the
    // item is already processed or has recorded a specific failure; poll
    // the UI's own processing-state label rather than the network
    // response directly, since that's what a real user actually sees.
    await expect(page.getByText(/Uploading…|Processing…/)).toHaveCount(0, {
      timeout: 30000,
    });
    await expect(page.getByText("Failed to process")).toHaveCount(0);
    await expect(page.getByText("Ready")).toBeVisible({ timeout: 30000 });
  });
});
