import path from "node:path";
import { test, expect } from "@playwright/test";
import { signInUi } from "./helpers/sign-in";

/**
 * Three-tier proof of the Server Action body-size margin (round-6 plan
 * R6-3): next.config.ts's experimental.serverActions.bodySizeLimit
 * ("2.5mb") carries an explicit +25% margin over
 * lib/story/content-import.ts's MAX_IMPORT_INPUT_BYTES (2,000,000 bytes,
 * the authoritative PRODUCT-level limit enforced inside
 * importStoryContentAction() itself) -- these are two different
 * boundaries, and a real request must be used to prove they behave
 * differently, not merely asserted from reading the numbers:
 *
 *  1. Below the product limit -- reaches importStoryContentAction(), which
 *     runs its real conversion logic (accepted or rejected on the
 *     schema's own merits, not the size gate).
 *  2. Above the product limit, below the framework ceiling -- reaches
 *     importStoryContentAction(), which returns the typed
 *     "input_too_large" rejection; the UI shows that specific message.
 *  3. Above the framework ceiling entirely -- Next rejects the request
 *     before the action runs at all; the UI is asserted to reach SOME
 *     handled, non-broken state (components/story/content-import-panel.tsx's
 *     own catch block), not necessarily the same copy as case 2 and not an
 *     unhandled crash/blank page.
 *
 * Requires the same fixed editor test account as e2e/editorial-upload.spec.ts
 * (and the same get_my_story_with_draft() migration dependency -- see that
 * file's header comment; both migrations are now pushed) since the
 * content-import panel only renders on the real editorial edit page.
 */

try {
  process.loadEnvFile(path.join(__dirname, "..", ".env.test.local"));
} catch {
  // File doesn't exist in this environment -- the tests below skip themselves.
}

const EDITOR_EMAIL = process.env.SUPABASE_RLS_TEST_EDITOR_EMAIL;
const EDITOR_PASSWORD = process.env.SUPABASE_RLS_TEST_EDITOR_PASSWORD;
const hasEditorCredentials = Boolean(EDITOR_EMAIL && EDITOR_PASSWORD);

// Comfortably under storyContentSchema's 50,000-character document cap,
// content-import.ts's 2,000,000-byte MAX_IMPORT_INPUT_BYTES, AND (the one
// that actually binds here) storyContentSchema's separate 200-block cap --
// each "Paragraph one./Paragraph two." pair becomes 2 blocks, so this repeat
// count must stay well under 100 or the plain-text converter produces a
// real, correctly-rejected "invalid_content" (too many blocks) instead of
// reaching the success path this test is named for. (An earlier version of
// this fixture used .repeat(500), producing 1000 blocks -- comfortably
// under the two size caps mentioned above, but 5x over the block cap, so it
// exercised a real schema rejection rather than "real conversion logic"
// succeeding as intended.)
const BELOW_PRODUCT_LIMIT = "Paragraph one.\n\nParagraph two.\n\n".repeat(80); // ~2.6KB, 160 blocks

// Over MAX_IMPORT_INPUT_BYTES (2,000,000) but under next.config.ts's
// bodySizeLimit ("2.5mb").
const ABOVE_PRODUCT_LIMIT_BELOW_FRAMEWORK_CEILING = "a".repeat(2_200_000);

// Over the framework ceiling entirely.
const ABOVE_FRAMEWORK_CEILING = "a".repeat(3_000_000);

async function signInAsEditorAndOpenAnEditorialDraft(
  page: import("@playwright/test").Page,
) {
  await signInUi(page, EDITOR_EMAIL!, EDITOR_PASSWORD!);

  const runId = Math.random().toString(36).slice(2, 8);
  await page.goto("/editorial/new");
  await page.getByLabel("Title").fill(`e2e-body-size-${runId}`);
  await page.getByLabel("New (unlinked) contributor").check();
  await page
    .getByLabel("Display name")
    .fill(`E2E Body-Size Contributor ${runId}`);
  await page.getByRole("button", { name: "Create Import Draft" }).click();
  await page.waitForURL(/\/editorial\/[^/]+\/edit$/, { timeout: 15000 });
}

test.describe("Server Action body-size margin (R6-3)", () => {
  test.skip(
    !hasEditorCredentials,
    "Requires SUPABASE_RLS_TEST_EDITOR_EMAIL/PASSWORD in .env.test.local.",
  );

  test("below the product limit reaches real conversion logic", async ({
    page,
  }) => {
    await signInAsEditorAndOpenAnEditorialDraft(page);
    await page.getByPlaceholder("Pasted plain text…").fill(BELOW_PRODUCT_LIMIT);
    await page.getByRole("button", { name: "Preview conversion" }).click();
    // Reaches the action for real -- either a successful preview (block
    // count shown) or a schema-level rejection, but NOT the size-gate
    // message and NOT the framework-level catch-all.
    await expect(
      page.getByText(/block\(s\) produced|too long \(max/i),
    ).toBeVisible({ timeout: 15000 });
  });

  test("above the product limit, below the framework ceiling: typed rejection", async ({
    page,
  }) => {
    await signInAsEditorAndOpenAnEditorialDraft(page);
    await page
      .getByPlaceholder("Pasted plain text…")
      .fill(ABOVE_PRODUCT_LIMIT_BELOW_FRAMEWORK_CEILING);
    await page.getByRole("button", { name: "Preview conversion" }).click();
    await expect(
      page.getByText("That's too much text to import at once"),
    ).toBeVisible({ timeout: 20000 });
  });

  test("above the framework ceiling entirely: handled, not a crash", async ({
    page,
  }) => {
    await signInAsEditorAndOpenAnEditorialDraft(page);
    await page
      .getByPlaceholder("Pasted plain text…")
      .fill(ABOVE_FRAMEWORK_CEILING);
    await page.getByRole("button", { name: "Preview conversion" }).click();
    // Not necessarily the same copy as the product-limit case -- just some
    // real, visible, non-crashed handled state.
    await expect(
      page.getByText(/couldn't be sent|too much text|something went wrong/i),
    ).toBeVisible({ timeout: 20000 });
    // And, critically, not a blank page / unhandled framework error overlay.
    await expect(page.locator("body")).not.toContainText("Application error");
  });
});
