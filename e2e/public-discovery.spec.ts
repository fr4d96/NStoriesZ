import path from "node:path";
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Prompt 5: real, UI-level (browser-driven) coverage of the public
 * discovery experience -- browse/filter/search, story detail, reporting,
 * and the sitemap/robots exclusions. Requires the same fixed test-account
 * pool tests/integration/story-rls.integration.test.ts uses (see
 * docs/architecture.md "RLS integration test setup"), loaded from
 * .env.test.local; skips itself (not a hard failure) if that file/those
 * credentials aren't present, matching e2e/editorial-upload.spec.ts and
 * e2e/cross-contributor-access.spec.ts's established pattern.
 *
 * The fixture story is published via direct RPC calls (same
 * create -> submit -> approve flow the RLS suite uses) rather than through
 * the authoring UI -- publishing a story isn't in this prompt's scope,
 * only reading/browsing one is, so there's nothing to gain from driving
 * the whole authoring flow through the browser here. Titled with a leading
 * `rls-test` token so its slug falls inside
 * scripts/rls-test-cleanup.sql's existing `slug like 'rls-test-%'` scope --
 * no new cleanup path needed.
 */
try {
  process.loadEnvFile(path.join(__dirname, "..", ".env.test.local"));
} catch {
  // File doesn't exist in this environment -- the tests below skip themselves.
}

const SUPABASE_URL = process.env.SUPABASE_RLS_TEST_URL;
const KEY = process.env.SUPABASE_RLS_TEST_PUBLISHABLE_KEY;
const OWNER_EMAIL = process.env.SUPABASE_RLS_TEST_OWNER_EMAIL;
const OWNER_PASSWORD = process.env.SUPABASE_RLS_TEST_OWNER_PASSWORD;
const MODERATOR_EMAIL = process.env.SUPABASE_RLS_TEST_MODERATOR_EMAIL;
const MODERATOR_PASSWORD = process.env.SUPABASE_RLS_TEST_MODERATOR_PASSWORD;

const hasCredentials = Boolean(
  SUPABASE_URL &&
  KEY &&
  OWNER_EMAIL &&
  OWNER_PASSWORD &&
  MODERATOR_EMAIL &&
  MODERATOR_PASSWORD,
);

const runId = Math.random().toString(36).slice(2, 10);
const storyTitle = `rls-test-e2e-discovery-${runId}`;

let fixtureSlug: string | undefined;

test.beforeAll(async () => {
  test.setTimeout(60_000);
  if (!hasCredentials) return;

  const anon = () => createClient<Database>(SUPABASE_URL!, KEY!);
  const owner = anon();
  const moderator = anon();

  const { error: ownerSignInError } = await owner.auth.signInWithPassword({
    email: OWNER_EMAIL!,
    password: OWNER_PASSWORD!,
  });
  if (ownerSignInError) throw ownerSignInError;
  const { error: modSignInError } = await moderator.auth.signInWithPassword({
    email: MODERATOR_EMAIL!,
    password: MODERATOR_PASSWORD!,
  });
  if (modSignInError) throw modSignInError;

  const { data: termsVersion, error: termsError } = await owner.rpc(
    "current_terms_version",
  );
  if (termsError || !termsVersion) {
    throw new Error(`Could not fetch terms version: ${termsError?.message}`);
  }

  const { data: created, error: createError } = await owner.rpc(
    "create_self_service_draft",
    {
      p_title: storyTitle,
      p_content_json: [
        {
          type: "paragraph",
          text: [
            {
              text: "A real published fixture for the public discovery e2e spec.",
            },
          ],
        },
      ],
      p_total_expense_nzd_cents: 750000,
      p_travel_style: "e2e-discovery-style",
    },
  );
  if (createError || !created) {
    throw new Error(`Could not create fixture draft: ${createError?.message}`);
  }
  const storyId = created[0].story_id;
  const revisionId = created[0].revision_id;

  const { data: draft } = await owner.rpc("get_my_story_with_draft", {
    p_story_id: storyId,
  });
  fixtureSlug = draft![0].slug;
  const version = draft![0].version;

  const { error: submitError } = await owner.rpc(
    "submit_revision_with_consent",
    {
      p_revision_id: revisionId,
      p_expected_version: version,
      p_confirmation_method: "account",
      p_publication_confirmed: true,
      p_expected_terms_version: termsVersion,
    },
  );
  if (submitError) throw new Error(`Could not submit: ${submitError.message}`);

  const { data: attemptId, error: beginError } = await moderator.rpc(
    "begin_story_publication_attempt",
    { p_revision_id: revisionId },
  );
  if (beginError || !attemptId) {
    throw new Error(
      `Could not begin publication attempt: ${beginError?.message}`,
    );
  }
  const { error: finalizeError } = await moderator.rpc(
    "finalize_story_publication",
    {
      p_revision_id: revisionId,
      p_approval_attempt_id: attemptId,
    },
  );
  if (finalizeError) {
    throw new Error(`Could not finalize publication: ${finalizeError.message}`);
  }

  await owner.auth.signOut();
  await moderator.auth.signOut();
});

test.describe("public browse/search (mobile viewport first)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("stories page loads, filters collapse behind a disclosure, and search finds the fixture", async ({
    page,
  }) => {
    test.skip(!hasCredentials, "requires .env.test.local");

    const response = await page.goto("/stories");
    expect(response?.status()).toBeLessThan(400);
    await expect(
      page.getByRole("heading", { level: 1, name: "Stories" }),
    ).toBeVisible();

    // Collapsed by default on mobile: the summary is visible, the filter
    // fields inside aren't, until it's expanded. Uses a direct locator, not
    // getByLabel -- confirmed (DOM inspection, computed styles, and even
    // Playwright's own failure-snapshot accessibility tree) that the
    // region <select> is correctly implicitly labelled and visible, but
    // getByLabel() on a native <select> unreliably reports 0 matches in
    // this Chromium build regardless -- a tooling quirk, not an app defect.
    const regionField = page.locator('select[name="region"]');
    await expect(regionField).toBeHidden();
    await page.getByText("Filters", { exact: true }).click();
    await expect(regionField).toBeVisible();

    await page.goto(`/stories?q=${encodeURIComponent(storyTitle)}`);
    await expect(page.getByRole("link", { name: storyTitle })).toBeVisible();

    await page.goto("/stories?q=no-such-story-should-ever-match-this-query");
    await expect(
      page.getByText(/no stories match those filters yet/i),
    ).toBeVisible();
  });
});

test.describe("public browse (desktop viewport)", () => {
  test("filters are visible without expanding anything", async ({ page }) => {
    test.skip(!hasCredentials, "requires .env.test.local");

    await page.goto("/stories");
    await expect(page.locator('select[name="region"]')).toBeVisible();
  });
});

test.describe("story detail", () => {
  test("renders title, personal-experience label, content, and a canonical link", async ({
    page,
  }) => {
    test.skip(!hasCredentials, "requires .env.test.local");

    const response = await page.goto(`/stories/${fixtureSlug}`);
    expect(response?.status()).toBe(200);

    await expect(
      page.getByRole("heading", { level: 1, name: storyTitle }),
    ).toBeVisible();
    // The site footer also carries a similar disclaimer ("one person's
    // *personal* experience, not immigration..."), so match the label's
    // own, more specific phrasing to avoid a strict-mode ambiguity.
    await expect(page.getByText(/one person's experience/i)).toBeVisible();
    await expect(
      page.getByText(
        /a real published fixture for the public discovery e2e spec/i,
      ),
    ).toBeVisible();

    const canonical = page.locator('link[rel="canonical"]');
    await expect(canonical).toHaveAttribute(
      "href",
      new RegExp(`/stories/${fixtureSlug}$`),
    );
  });

  test("returns a real 404 for a slug that doesn't exist", async ({ page }) => {
    const response = await page.goto(
      "/stories/this-slug-does-not-exist-at-all",
    );
    expect(response?.status()).toBe(404);
  });

  test("signed-out visitors see a sign-in prompt instead of the report form", async ({
    page,
  }) => {
    test.skip(!hasCredentials, "requires .env.test.local");

    await page.goto(`/stories/${fixtureSlug}`);
    await page.getByRole("button", { name: "Report this story" }).click();
    await page.getByRole("button", { name: "Submit report" }).click();
    await expect(page.getByRole("link", { name: /sign in/i })).toBeVisible();
  });

  test("a signed-in visitor can submit a report and gets a neutral confirmation", async ({
    page,
  }) => {
    test.skip(!hasCredentials, "requires .env.test.local");

    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(OWNER_EMAIL!);
    await page.getByLabel("Password").fill(OWNER_PASSWORD!);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).not.toHaveURL(/\/sign-in/);

    await page.goto(`/stories/${fixtureSlug}`);
    await page.getByRole("button", { name: "Report this story" }).click();
    await page.getByLabel(/reason/i).selectOption("other");
    await page.getByRole("button", { name: "Submit report" }).click();
    await expect(
      page.getByText(/your report has been submitted for review/i),
    ).toBeVisible();
  });
});

test.describe("SEO surfaces", () => {
  // sitemap.xml is statically generated with `revalidate = 3600` -- the
  // fixture created in this file's beforeAll (after the production build
  // that serves this test run) won't appear until that window elapses or
  // something calls revalidatePath("/sitemap.xml"), so this only asserts
  // structure/well-formedness, not that today's fixture specifically
  // appears -- that freshness question belongs to lib/story/public-cache.ts
  // and Prompt 6's future publish/archive callers, not a single-process
  // build-then-serve e2e run.
  test("sitemap.xml responds with valid, story-inclusive XML", async ({
    request,
  }) => {
    const response = await request.get("/sitemap.xml");
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toContain("<?xml");
    expect(body).toContain("<urlset");
    expect(body).toContain(`${new URL(response.url()).origin}/stories`);
    expect(body).toMatch(/\/stories\/[^<]+</);
  });

  test("robots.txt disallows every staff/authenticated surface", async ({
    request,
  }) => {
    const response = await request.get("/robots.txt");
    expect(response.status()).toBe(200);
    const body = await response.text();
    for (const path of [
      "/editorial",
      "/moderation",
      "/admin",
      "/my-stories",
      "/account",
      "/sign-in",
    ]) {
      expect(body).toContain(path);
    }
  });
});

test.describe("contributor pages", () => {
  test("contributors index loads without an account", async ({ page }) => {
    const response = await page.goto("/contributors");
    expect(response?.status()).toBeLessThan(400);
    await expect(
      page.getByRole("heading", { level: 1, name: "Contributors" }),
    ).toBeVisible();
  });

  test("a non-existent contributor slug returns a real 404", async ({
    page,
  }) => {
    const response = await page.goto(
      "/contributors/this-contributor-does-not-exist",
    );
    expect(response?.status()).toBe(404);
  });
});
