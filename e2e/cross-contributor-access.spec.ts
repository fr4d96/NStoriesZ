import path from "node:path";
import fs from "node:fs";
import { test, expect, type Page } from "@playwright/test";

/**
 * Prompt 4 Sub-phase 5: real, UI-level (browser-driven) proof that one
 * contributor cannot reach ANOTHER contributor's own story through the
 * actual Next.js pages -- not the database (tests/integration/story-rls.integration.test.ts
 * already proves the RLS/RPC layer rejects this at the API level), and not
 * a different account's OWN story (e2e/editorial-upload.spec.ts). Nothing
 * else in this repo signs in as one account, then a second, independent
 * account, and hits the first account's story through /stories/[id]/edit
 * or /stories/[id]/preview.
 *
 * This also answers a specific, previously-unverified question (Prompt 4
 * Sub-phase 5 plan, "Context point 2"): app/(contributor)/stories/[id]/edit/page.tsx
 * and app/(contributor)/stories/[id]/preview/page.tsx (and, spot-checked,
 * app/(editor)/editorial/[id]/edit/page.tsx) all gate access with a plain
 * `if (!draft) notFound();` deep inside an async Server Component, and
 * proxy.ts only checks *authentication* for these dynamic :id routes, never
 * per-row *ownership* -- it structurally can't without an extra DB round
 * trip. This is the exact shape of bug already found and fixed for
 * /editorial's blanket role check (a notFound() called from deep in a
 * Server Component tree returned a live HTTP 200, with the real 404 only
 * appearing inside the streamed RSC payload; see proxy.ts's
 * STAFF_EDITORIAL_PATH comment). Nobody had checked whether the *per-row*
 * case (as opposed to /editorial's *role-level* case) has the same defect
 * -- this spec asserts the real HTTP response status directly, it does not
 * assume either outcome.
 *
 * Requires the SAME fixed owner/other test accounts
 * tests/integration/story-rls.integration.test.ts uses (see
 * docs/architecture.md "RLS integration test setup"), loaded from
 * .env.test.local. Skips itself (not a hard failure) if that file/
 * credentials aren't present, matching e2e/editorial-upload.spec.ts's
 * pattern exactly.
 *
 * Fixture hygiene: the draft this spec creates is titled with a leading
 * `rls-test` token specifically so `_generate_story_slug()`'s resulting
 * slug (`rls-test-cross-contributor-e2e-<runid>-<8hex>`) falls inside
 * scripts/rls-test-cleanup.sql's existing `slug like 'rls-test-%'` scope --
 * this spec deliberately needs no new cleanup script of its own.
 */

try {
  process.loadEnvFile(path.join(__dirname, "..", ".env.test.local"));
} catch {
  // File doesn't exist in this environment -- the tests below skip themselves.
}

const OWNER_EMAIL = process.env.SUPABASE_RLS_TEST_OWNER_EMAIL;
const OWNER_PASSWORD = process.env.SUPABASE_RLS_TEST_OWNER_PASSWORD;
const OTHER_EMAIL = process.env.SUPABASE_RLS_TEST_OTHER_EMAIL;
const OTHER_PASSWORD = process.env.SUPABASE_RLS_TEST_OTHER_PASSWORD;
const EDITOR_EMAIL = process.env.SUPABASE_RLS_TEST_EDITOR_EMAIL;
const EDITOR_PASSWORD = process.env.SUPABASE_RLS_TEST_EDITOR_PASSWORD;
const hasOwnerOtherCredentials = Boolean(
  OWNER_EMAIL && OWNER_PASSWORD && OTHER_EMAIL && OTHER_PASSWORD,
);
const hasEditorCredentials = Boolean(EDITOR_EMAIL && EDITOR_PASSWORD);

const FIXTURE_PATH = path.join(
  __dirname,
  "..",
  "tests",
  "integration",
  "fixtures",
  "tiny.png",
);

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"));
}

test.describe("cross-contributor UI-level access denial", () => {
  test.skip(
    !hasOwnerOtherCredentials,
    "Requires SUPABASE_RLS_TEST_OWNER_EMAIL/PASSWORD and SUPABASE_RLS_TEST_OTHER_EMAIL/PASSWORD in .env.test.local — see docs/architecture.md 'RLS integration test setup'.",
  );

  test("a second contributor cannot read, preview, or upload to another contributor's draft", async ({
    browser,
  }) => {
    const runId = Math.random().toString(36).slice(2, 8);
    const title = `rls-test cross contributor e2e ${runId}`;

    // --- Step 1: owner creates a draft through the real UI ---
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    await signIn(ownerPage, OWNER_EMAIL!, OWNER_PASSWORD!);

    await ownerPage.goto("/stories/new");
    await ownerPage.getByLabel("Working title").fill(title);
    await ownerPage.getByRole("button", { name: "Start writing" }).click();
    await ownerPage.waitForURL(/\/stories\/[^/]+\/edit$/, { timeout: 15000 });

    const ownerEditUrl = new URL(ownerPage.url());
    const match = ownerEditUrl.pathname.match(/^\/stories\/([^/]+)\/edit$/);
    if (!match) {
      throw new Error(
        `Could not extract story id from owner edit URL: ${ownerEditUrl.pathname}`,
      );
    }
    const storyId = match[1];

    // Capture the real revisionId the way a leaked/guessed ID would reach an
    // attacker in practice: intercept the *owner's own* legitimate upload
    // request (the revisionId is never present in the URL or plain DOM --
    // it's a client-component prop threaded into the multipart body by
    // components/story/image-upload-manager.tsx's fetch() call). This lets
    // step 5 below test the strongest case: `other` presents a REAL
    // revisionId and still gets rejected by _authorize_revision_edit(),
    // not just a not-found due to a bad ID.
    let capturedRevisionId = "";
    await ownerPage.route("**/edit/upload", async (route) => {
      const postData = route.request().postData() ?? "";
      const revisionMatch = postData.match(
        /name="revisionId"\r?\n\r?\n([0-9a-fA-F-]{36})/,
      );
      if (revisionMatch) capturedRevisionId = revisionMatch[1];
      await route.continue();
    });

    const ownerFileInput = ownerPage.locator("#story-image-upload");
    await ownerFileInput.setInputFiles(FIXTURE_PATH);
    await expect(ownerPage.getByText(/Uploading…|Processing…/)).toHaveCount(0, {
      timeout: 30000,
    });
    expect(capturedRevisionId).toMatch(/^[0-9a-fA-F-]{36}$/);

    await ownerContext.close();

    // --- Step 2: a second, fully independent browser context signs in as `other` ---
    const otherContext = await browser.newContext();
    const otherPage = await otherContext.newPage();
    await signIn(otherPage, OTHER_EMAIL!, OTHER_PASSWORD!);

    // --- Step 3: `other` navigates directly to owner's /edit page ---
    const editResponse = await otherPage.goto(`/stories/${storyId}/edit`);
    expect(editResponse).not.toBeNull();
    expect(editResponse!.status()).toBe(404);
    await expect(otherPage.getByText(title)).toHaveCount(0);
    await expect(
      otherPage.locator('input[name="title"], textarea'),
    ).toHaveCount(0);

    // --- Step 4: `other` navigates directly to owner's /preview page ---
    const previewResponse = await otherPage.goto(`/stories/${storyId}/preview`);
    expect(previewResponse).not.toBeNull();
    expect(previewResponse!.status()).toBe(404);
    await expect(otherPage.getByText(title)).toHaveCount(0);

    // --- Step 5: `other` attempts a direct, forged multipart POST to
    // owner's upload endpoint, using a REAL revisionId (captured above) and
    // `other`'s own authenticated session cookies. The Route Handler's own
    // _authorize_revision_edit()-backed RPC chain must reject this over
    // real HTTP, not just via the RLS suite's direct RPC call. ---
    const fixtureBytes = fs.readFileSync(FIXTURE_PATH);
    const uploadResponse = await otherPage.request.post(
      `/stories/${storyId}/edit/upload`,
      {
        multipart: {
          file: {
            name: "tiny.png",
            mimeType: "image/png",
            buffer: fixtureBytes,
          },
          revisionId: capturedRevisionId,
          expectedVersion: "1",
        },
      },
    );
    expect(uploadResponse.status()).toBeGreaterThanOrEqual(400);
    expect(uploadResponse.status()).toBeLessThan(500);

    await otherContext.close();
  });

  // Spot-check (per the Sub-phase 5 plan): the editorial side gates access
  // the same way -- app/(editor)/editorial/[id]/edit/page.tsx also calls a
  // plain `if (!draft) notFound();`, and proxy.ts's STAFF_EDITORIAL_PATH
  // check only verifies the `editor`/`admin` ROLE, never per-row ownership
  // of a specific editorial draft. Uses `other` (a plain contributor, no
  // staff role) against `editor`'s own editorial draft -- this exercises
  // BOTH the role gate and, if `other` somehow had the role, would exercise
  // the per-row gate too. Skips independently if editor credentials aren't
  // present (they're optional relative to the owner/other pair above).
  test("a non-staff account cannot read another party's editorial draft, and a staff account with no relation to a story gets the same real 404 (per-row regression)", async ({
    browser,
  }) => {
    test.skip(
      !hasEditorCredentials,
      "Requires SUPABASE_RLS_TEST_EDITOR_EMAIL/PASSWORD in .env.test.local.",
    );

    const runId = Math.random().toString(36).slice(2, 8);

    const editorContext = await browser.newContext();
    const editorPage = await editorContext.newPage();
    await signIn(editorPage, EDITOR_EMAIL!, EDITOR_PASSWORD!);

    await editorPage.goto("/editorial/new");
    await editorPage
      .getByLabel("Title")
      .fill(`rls-test cross contributor editorial e2e ${runId}`);
    await editorPage.getByLabel("New (unlinked) contributor").check();
    await editorPage
      .getByLabel("Display name")
      .fill(`RLS Test Cross Contributor Editorial ${runId}`);
    await editorPage
      .getByRole("button", { name: "Create Import Draft" })
      .click();
    await editorPage.waitForURL(/\/editorial\/[^/]+\/edit$/, {
      timeout: 15000,
    });

    const editorialEditUrl = new URL(editorPage.url());
    const editorialMatch = editorialEditUrl.pathname.match(
      /^\/editorial\/([^/]+)\/edit$/,
    );
    if (!editorialMatch) {
      throw new Error(
        `Could not extract editorial story id from URL: ${editorialEditUrl.pathname}`,
      );
    }
    const editorialStoryId = editorialMatch[1];

    // Sanity check: the editor who actually created this import draft (and
    // is therefore its assigned editor) can still open it normally -- the
    // per-row fix in proxy.ts must not have turned into a blanket deny.
    const ownEditResponse = await editorPage.goto(
      `/editorial/${editorialStoryId}/edit`,
    );
    expect(ownEditResponse).not.toBeNull();
    expect(ownEditResponse!.status()).toBe(200);

    // --- Regression case for the per-row leak this sub-phase found and
    // fixed: a genuinely-role-authorized editor, but one with NO relation
    // (not assigned, not the owner/linked contributor) to a DIFFERENT
    // story, must also get a real 404 -- not just a signed-out/wrong-role
    // visitor (that's the case below). Before the proxy.ts fix, this
    // returned a live 200 (a generic "Something went wrong" error page,
    // from get_my_story_with_draft()'s raised exception never being turned
    // into a real HTTP status). Reuses the owner's self-service draft from
    // the test above's pattern -- created fresh here so this test stays
    // independently runnable. ---
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    await signIn(ownerPage, OWNER_EMAIL!, OWNER_PASSWORD!);
    await ownerPage.goto("/stories/new");
    await ownerPage
      .getByLabel("Working title")
      .fill(`rls-test cross contributor editorial per row e2e ${runId}`);
    await ownerPage.getByRole("button", { name: "Start writing" }).click();
    await ownerPage.waitForURL(/\/stories\/[^/]+\/edit$/, { timeout: 15000 });
    const ownerStoryMatch = new URL(ownerPage.url()).pathname.match(
      /^\/stories\/([^/]+)\/edit$/,
    );
    if (!ownerStoryMatch) {
      throw new Error("Could not extract owner story id.");
    }
    const unrelatedStoryId = ownerStoryMatch[1];
    await ownerContext.close();

    const unrelatedResponse = await editorPage.goto(
      `/editorial/${unrelatedStoryId}/edit`,
    );
    expect(unrelatedResponse).not.toBeNull();
    expect(unrelatedResponse!.status()).toBe(404);

    await editorContext.close();

    // --- Role-level case: a plain contributor with no staff role at all,
    // hitting a real editorial draft. Blocked earlier, by proxy.ts's
    // pre-existing STAFF_EDITORIAL_PATH role check (unchanged by this
    // sub-phase). ---
    const otherContext = await browser.newContext();
    const otherPage = await otherContext.newPage();
    await signIn(otherPage, OTHER_EMAIL!, OTHER_PASSWORD!);

    const response = await otherPage.goto(
      `/editorial/${editorialStoryId}/edit`,
    );
    expect(response).not.toBeNull();
    expect(response!.status()).toBe(404);

    await otherContext.close();
  });
});
