import path from "node:path";
import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { signInUi } from "./helpers/sign-in";

/**
 * 2026-09-07: a contributor can download their own story as a PDF
 * (app/(contributor)/stories/[id]/export).
 *
 * Two things are worth spending a live browser on, and they are not the
 * layout (lib/story/story-pdf.test.ts covers that headlessly against the real
 * renderer):
 *
 *  1. The bytes a signed-in owner actually receives are a real, readable PDF
 *     containing their own words — proving the route's font loading and image
 *     fetching work against the deployed file tracing, not just in Vitest.
 *  2. NOBODY ELSE can get them. This endpoint mints a file containing a
 *     private draft, so the negative cases (another contributor, unrelated
 *     staff, signed out) matter more than the happy path
 *     (Engineering Rules 2, 10, 12).
 *
 * RUN AND PASSING against the live linked project:
 *
 *   node --env-file=.env.test.local node_modules/.bin/playwright test \
 *     e2e/story-export.spec.ts --workers=1
 *
 * Fixture hygiene: the title/slug leads with `rls-test`, so it falls inside
 * scripts/rls-test-cleanup.sql's existing `slug like 'rls-test-%'` scope.
 *
 * KNOWN, HARMLESS NOISE: the download test makes the dev server log
 * "Error: The destination stream closed early". That is Playwright's
 * APIRequestContext closing the connection once it has buffered the body, not
 * a fault in the route — checked by driving the same download through a real
 * browser navigation (page.waitForEvent("download")), which completes with no
 * such log. The PDF this test receives is complete: pdfjs parses it and finds
 * text the renderer only emits on later pages.
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
const OTHER_EMAIL = process.env.SUPABASE_RLS_TEST_OTHER_EMAIL;
const OTHER_PASSWORD = process.env.SUPABASE_RLS_TEST_OTHER_PASSWORD;
const MODERATOR_EMAIL = process.env.SUPABASE_RLS_TEST_MODERATOR_EMAIL;
const MODERATOR_PASSWORD = process.env.SUPABASE_RLS_TEST_MODERATOR_PASSWORD;

const hasAllCredentials = Boolean(
  URL &&
  KEY &&
  OWNER_EMAIL &&
  OWNER_PASSWORD &&
  OTHER_EMAIL &&
  OTHER_PASSWORD &&
  MODERATOR_EMAIL &&
  MODERATOR_PASSWORD,
);

const STORY_TITLE = `rls-test export Whangārei ${Date.now()}`;
const STORY_SENTENCE =
  "We drove south from Whakatāne with a boot full of wet gear.";

async function signInRpcClient(
  email: string,
  password: string,
): Promise<SupabaseClient> {
  const client = createClient(URL!, KEY!);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

/**
 * A saved (never submitted) draft owned by the RLS-test owner. A DRAFT on
 * purpose: it is the state where an accidental leak would matter most.
 */
async function createDraftStory(owner: SupabaseClient): Promise<string> {
  const { data: draft, error: draftError } = await owner.rpc(
    "create_self_service_draft",
    { p_title: STORY_TITLE },
  );
  if (draftError || !draft?.[0]) {
    throw new Error(
      `create_self_service_draft failed: ${draftError?.message ?? "no data"}`,
    );
  }
  const storyId: string = draft[0].story_id ?? draft[0].id;
  const revisionId: string = draft[0].revision_id;

  const { error: saveError } = await owner.rpc("save_revision_draft", {
    p_revision_id: revisionId,
    p_expected_version: 1,
    p_title: STORY_TITLE,
    p_excerpt: "What a year of picking actually cost.",
    p_content_json: [
      {
        type: "markdown",
        text: `## Getting there\n\n${STORY_SENTENCE}\n\n- Wet weather gear\n- Steel-cap boots\n`,
      },
    ],
  });
  if (saveError) {
    throw new Error(`save_revision_draft failed: ${saveError.message}`);
  }
  return storyId;
}

/** Every text run in a rendered PDF, via the pdfjs build this repo already ships. */
async function pdfText(bytes: Buffer): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjsLib.getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
  });
  const doc = await task.promise;
  try {
    let out = "";
    for (let page = 1; page <= doc.numPages; page += 1) {
      const content = await (await doc.getPage(page)).getTextContent();
      for (const item of content.items) if ("str" in item) out += item.str;
      out += "\n";
    }
    return out;
  } finally {
    await task.destroy();
  }
}

test.describe("story PDF export", () => {
  test.skip(
    !hasAllCredentials,
    "Requires the SUPABASE_RLS_TEST_* owner/other/moderator credentials in .env.test.local — see docs/architecture.md 'RLS integration test setup'.",
  );

  let storyId: string;

  test.beforeAll(async () => {
    const owner = await signInRpcClient(OWNER_EMAIL!, OWNER_PASSWORD!);
    storyId = await createDraftStory(owner);
  });

  test("the owner downloads a real PDF containing their own story", async ({
    page,
  }) => {
    await signInUi(page, OWNER_EMAIL!, OWNER_PASSWORD!);

    // page.request shares the browser context's cookies, so this is the same
    // authenticated session the download link would use.
    const response = await page.request.get(`/stories/${storyId}/export`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/pdf");
    expect(response.headers()["content-disposition"]).toContain("attachment");
    // A private draft must never be held by a shared cache.
    expect(response.headers()["cache-control"]).toContain("no-store");

    const bytes = Buffer.from(await response.body());
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");

    const text = await pdfText(bytes);
    expect(text).toContain(STORY_SENTENCE);
    expect(text).toContain("Getting there");
    // Macrons survive the round trip -- the reason this route embeds a font
    // instead of using a PDF base-14 one.
    expect(text).toContain("Whangārei");
    // Engineering Rule 17 travels with the file.
    expect(text).toContain("Personal experience, not advice");
    // And the copy says what it is: this story has never been published.
    expect(text).toContain("(Draft)");
  });

  test("the download link is offered on the contributor's own preview page", async ({
    page,
  }) => {
    await signInUi(page, OWNER_EMAIL!, OWNER_PASSWORD!);
    await page.goto(`/stories/${storyId}/preview`);
    await expect(
      page.getByRole("link", { name: "Download a copy" }),
    ).toBeVisible();
  });

  test("another contributor gets a flat 404, not someone else's draft", async ({
    page,
  }) => {
    await signInUi(page, OTHER_EMAIL!, OTHER_PASSWORD!);
    const response = await page.request.get(`/stories/${storyId}/export`);
    expect(response.status()).toBe(404);
    expect(response.headers()["content-type"]).not.toContain("application/pdf");
  });

  test("staff with no relation to the story cannot download it either", async ({
    page,
  }) => {
    // A moderator can legitimately review submitted work in the moderation
    // UI. This endpoint is narrower on purpose: it produces a file that
    // leaves the platform, so it is for the story's own contributor only.
    await signInUi(page, MODERATOR_EMAIL!, MODERATOR_PASSWORD!);
    const response = await page.request.get(`/stories/${storyId}/export`);
    expect(response.status()).toBe(404);
  });

  test("a signed-out request never reaches the PDF", async ({ browser }) => {
    const context = await browser.newContext();
    try {
      const response = await context.request.get(`/stories/${storyId}/export`, {
        maxRedirects: 0,
      });
      // proxy.ts redirects a signed-out caller on a protected path to
      // /sign-in; what matters is only that no PDF comes back.
      expect(response.status()).not.toBe(200);
      expect(response.headers()["content-type"] ?? "").not.toContain(
        "application/pdf",
      );
    } finally {
      await context.close();
    }
  });
});
