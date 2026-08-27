import path from "node:path";
import { test, expect } from "@playwright/test";
import { signInUi } from "./helpers/sign-in";

/**
 * Real, end-to-end proof of the direct-to-storage upload flow
 * (app/(contributor)/stories/[id]/edit/upload-actions.ts: begin -> browser
 * uploads straight to Supabase Storage -> finalize) exercised by a
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

// The same real HEIC fixture lib/story/heic.test.ts decodes at the unit
// level — reused here rather than duplicated, so both suites stay pinned
// to one real, committed HEIC file.
const HEIC_FIXTURE_PATH = path.join(
  __dirname,
  "..",
  "lib",
  "story",
  "__fixtures__",
  "sample.heic",
);

test.describe("editorial image upload (real direct-to-storage flow, real hosted project)", () => {
  test.skip(
    !hasEditorCredentials,
    "Requires SUPABASE_RLS_TEST_EDITOR_EMAIL/PASSWORD in .env.test.local — see docs/architecture.md 'RLS integration test setup'.",
  );

  test("editor creates an editorial import, uploads tiny.png, and it reaches processed", async ({
    page,
  }) => {
    const runId = Math.random().toString(36).slice(2, 8);

    await signInUi(page, EDITOR_EMAIL!, EDITOR_PASSWORD!);

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

  // Real, end-to-end proof of the HEIC-specific staging path this session
  // exists because of: the browser stages the raw HEIC directly into the
  // private bucket (bypassing this app's server, and therefore the ~4.5 MiB
  // effective ceiling on what a Vercel Node.js Function can receive
  // inbound -- see upload-actions.ts's own doc comment for the full root
  // cause), then transcodeHeicUploadAction downloads it server-side (an
  // ordinary OUTBOUND request, never subject to that limit), transcodes it
  // via the unchanged lib/story/heic.ts, and rewrites the reservation onto
  // the resulting original.jpg before finalize/process run exactly as they
  // do for any other format. A unit test cannot exercise this: it depends
  // on the real storage RLS policy (_can_write_reserved_media_path) and the
  // real Supabase Storage REST API accepting a direct browser upload.
  test("editor uploads a real HEIC photo, and it reaches processed", async ({
    page,
  }) => {
    const runId = Math.random().toString(36).slice(2, 8);

    await signInUi(page, EDITOR_EMAIL!, EDITOR_PASSWORD!);

    await page.goto("/editorial/new");
    await page.getByLabel("Title").fill(`e2e-editorial-heic-${runId}`);
    await page.getByLabel("New (unlinked) contributor").check();
    await page
      .getByLabel("Display name")
      .fill(`E2E Editorial HEIC Contributor ${runId}`);
    await page.getByRole("button", { name: "Create Import Draft" }).click();

    await page.waitForURL(/\/editorial\/[^/]+\/edit$/, { timeout: 15000 });

    const fileInput = page.locator("#story-image-upload");
    await fileInput.setInputFiles(HEIC_FIXTURE_PATH);

    await expect(page.getByText(/Uploading…|Processing…/)).toHaveCount(0, {
      timeout: 30000,
    });
    await expect(page.getByText("Failed to process")).toHaveCount(0);
    await expect(page.getByText("Ready")).toBeVisible({ timeout: 30000 });
  });
});
