import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { signInUi } from "./helpers/sign-in";

/**
 * Prompt 6 Stage 3: real, UI-level proof of the reports-triage workspace --
 * app/(moderation)/moderation/reports/{page,[id]/page,[id]/actions}.tsx.
 *
 * RUN AND PASSING (4/4, part of the same 12/12 batch as
 * e2e/moderation.spec.ts) against the live linked project. Requires
 * `--workers=1` -- see that file's header comment for why (shared live
 * queue state across workers, not an app defect).
 *
 * A real bug was found and fixed while getting the last three tests here to
 * pass reliably: the "Triage" link navigates client-side from
 * /moderation/reports (which has its OWN "Status"-labeled filter <select>)
 * to /moderation/reports/[id] (which has the resolution form's differently-
 * scoped "Status"-labeled <select>) -- without waiting for a detail-page-
 * only element first, `getByLabel("Status")` could transiently resolve to
 * the queue page's filter select mid-transition, silently leaving the
 * resolution form untouched at its default value when Save was clicked.
 * Every test now waits on the report's own category heading (matching the
 * one test that already did this and passed reliably from the start)
 * before touching the form.
 *
 * Fixture creation mirrors e2e/moderation.spec.ts's own pattern (direct RPC
 * calls through a signed-in client via @supabase/supabase-js for speed/
 * reliability) rather than a slower UI-driven flow -- Playwright is
 * reserved for the actual reports-triage page/Server-Action behavior under
 * test. The two helpers below
 * (createSubmittedSelfServiceRevision/approveViaUi) are copy-adapted from
 * that file rather than imported, since Playwright spec files in this repo
 * don't share a common fixture module today (grepped -- e2e/*.spec.ts each
 * define their own helpers); extracting a shared module is a reasonable
 * future cleanup, not done here to avoid touching a file (e2e/moderation.spec.ts)
 * outside this stage's own scope.
 *
 * Fixture hygiene: every fixture title/slug uses a leading `rls-test` token,
 * same convention as e2e/moderation.spec.ts and
 * scripts/rls-test-cleanup.sql's existing scope.
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
  const title = `rls-test reports triage e2e ${titleSuffix}`;
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
    p_excerpt: "An e2e fixture story for Prompt 6 Stage 3 reports triage.",
    p_content_json: [
      {
        type: "paragraph",
        text: [{ text: "Fixture content for reports triage." }],
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

/** Signs in as the moderator in the UI and approves a submitted revision. */
async function approveViaUi(page: Page, revisionId: string) {
  await signInUi(page, MODERATOR_EMAIL!, MODERATOR_PASSWORD!);
  await page.goto(`/moderation/stories/${revisionId}`);
  await page.getByRole("button", { name: "Approve and publish" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Story approved and published",
    { timeout: 20000 },
  );
}

test.describe("reports triage workspace (real UI, real hosted project)", () => {
  test.skip(
    !hasAllCredentials,
    "Requires the full SUPABASE_RLS_TEST_* pool (owner/editor/moderator) in .env.test.local -- see docs/architecture.md 'RLS integration test setup'.",
  );

  test("a non-moderator (editor) gets a flat 404 for /moderation/reports", async ({
    page,
  }) => {
    await signInUi(page, EDITOR_EMAIL!, EDITOR_PASSWORD!);
    const response = await page.goto("/moderation/reports");
    expect(response?.status()).toBe(404);
  });

  // Release audit: previously a known, accepted gap -- /moderation/reports/[id]
  // had no middleware-level per-row existence check (unlike
  // /moderation/stories/[revisionId]), so a nonexistent report id rendered a
  // live HTTP 200 via Next's deep notFound() instead of a real 404. Fixed by
  // can_view_moderation_report() (supabase/migrations/20260806100000_...)
  // wired into proxy.ts, mirroring can_view_moderation_review()'s pattern.
  test("a nonexistent report id gets a real 404, not a soft-200", async ({
    page,
  }) => {
    await signInUi(page, MODERATOR_EMAIL!, MODERATOR_PASSWORD!);
    const bogusId = "00000000-0000-0000-0000-000000000000";
    const response = await page.goto(
      `/moderation/reports/${bogusId}?storyId=${bogusId}`,
    );
    expect(response?.status()).toBe(404);
  });

  test("open -> reviewing -> resolved flow, with the internal note left private", async ({
    page,
  }) => {
    const runId = Math.random().toString(36).slice(2, 8);
    const owner = await signInRpcClient(OWNER_EMAIL!, OWNER_PASSWORD!);
    const { storyId, revisionId } = await createSubmittedSelfServiceRevision(
      owner,
      `resolve-${runId}`,
    );
    await approveViaUi(page, revisionId);

    // A non-serious category (spam_commercial) so the "resolved" transition
    // below doesn't also need to exercise the required-note rule (that's
    // covered by its own test below).
    const editor = await signInRpcClient(EDITOR_EMAIL!, EDITOR_PASSWORD!);
    const { error: reportError } = await editor.rpc("create_story_report", {
      p_story_id: storyId,
      p_category: "spam_commercial",
      p_details: `rls-test reports triage e2e ${runId} details`,
    });
    if (reportError) {
      throw new Error(`create_story_report failed: ${reportError.message}`);
    }

    await signInUi(page, MODERATOR_EMAIL!, MODERATOR_PASSWORD!);
    await page.goto("/moderation/reports?status=open&category=spam_commercial");
    const triageLink = page.getByRole("link", { name: "Triage" }).first();
    await triageLink.click();

    await expect(
      page.getByRole("heading", { name: "Spam / commercial" }),
    ).toBeVisible();

    // reviewing needs no note.
    await page.getByLabel("Status").selectOption("reviewing");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Report marked as under review.",
    );

    // resolved, with an optional note this time -- never shown back to any
    // non-staff surface (the internal-notes section on THIS page is the
    // only place it's rendered, and this page is staff-gated).
    await page.getByLabel("Status").selectOption("resolved");
    await page
      .getByPlaceholder("Optional")
      .fill("Confirmed as promotional spam, no further action needed.");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toContainText("Report resolved.");
    await expect(page.getByText("Confirmed as promotional spam")).toBeVisible();

    // Already-closed reports can't be reopened -- the form itself explains
    // why instead of re-showing a status selector.
    await page.reload();
    await expect(
      page.getByText(/already resolved and cannot be reopened/),
    ).toBeVisible();
  });

  test("dismissal flow for a non-serious category", async ({ page }) => {
    const runId = Math.random().toString(36).slice(2, 8);
    const owner = await signInRpcClient(OWNER_EMAIL!, OWNER_PASSWORD!);
    const { storyId, revisionId } = await createSubmittedSelfServiceRevision(
      owner,
      `dismiss-${runId}`,
    );
    await approveViaUi(page, revisionId);

    const editor = await signInRpcClient(EDITOR_EMAIL!, EDITOR_PASSWORD!);
    const { error: reportError } = await editor.rpc("create_story_report", {
      p_story_id: storyId,
      p_category: "other",
    });
    if (reportError) {
      throw new Error(`create_story_report failed: ${reportError.message}`);
    }

    await signInUi(page, MODERATOR_EMAIL!, MODERATOR_PASSWORD!);
    await page.goto("/moderation/reports?status=open&category=other");
    await page.getByRole("link", { name: "Triage" }).first().click();
    // Real bug found live via this exact race: the queue page (this URL)
    // and the detail page BOTH have a "Status"-labeled <select> (the
    // queue's own filter vs. this report's resolution form) -- without
    // waiting for a detail-page-only element first, getByLabel("Status")
    // below can transiently resolve to the queue's filter select instead
    // (still mid-transition), silently leaving the resolution form's own
    // select at its untouched default ("reviewing") when Save is clicked.
    // Every other test in this file already waits on a heading first; this
    // one and the next didn't.
    await expect(page.getByRole("heading", { name: "Other" })).toBeVisible();

    await page.getByLabel("Status").selectOption("dismissed");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toContainText("Report dismissed.");
  });

  test("a serious category requires a non-empty internal note to close", async ({
    page,
  }) => {
    const runId = Math.random().toString(36).slice(2, 8);
    const owner = await signInRpcClient(OWNER_EMAIL!, OWNER_PASSWORD!);
    const { storyId, revisionId } = await createSubmittedSelfServiceRevision(
      owner,
      `serious-${runId}`,
    );
    await approveViaUi(page, revisionId);

    const editor = await signInRpcClient(EDITOR_EMAIL!, EDITOR_PASSWORD!);
    const { error: reportError } = await editor.rpc("create_story_report", {
      p_story_id: storyId,
      p_category: "harassment",
      p_details: "Contains harassing language toward another traveller.",
    });
    if (reportError) {
      throw new Error(`create_story_report failed: ${reportError.message}`);
    }

    await signInUi(page, MODERATOR_EMAIL!, MODERATOR_PASSWORD!);
    await page.goto("/moderation/reports?status=open&category=harassment");
    await page.getByRole("link", { name: "Triage" }).first().click();
    // See the "dismissal flow" test's comment above -- same navigation
    // race, same fix.
    await expect(
      page.getByRole("heading", { name: "Harassment" }),
    ).toBeVisible();

    // The client-side required attribute blocks submission (browser
    // validation, no network round trip) when closing a serious-category
    // report with an empty note -- select "resolved" and submit without
    // filling the textarea.
    await page.getByLabel("Status").selectOption("resolved");
    await expect(
      page.getByText(/A note is required to resolved a report/),
    ).toBeVisible();

    // Also exercise the server-side rejection directly (DB is the real,
    // non-bypassable source of truth per Engineering Rule 3), in case the
    // client-side `required` attribute is ever removed/bypassed.
    const moderator = await signInRpcClient(
      MODERATOR_EMAIL!,
      MODERATOR_PASSWORD!,
    );
    const { data: reports } = await moderator.rpc("list_reports_for_staff", {
      p_story_id: storyId,
    });
    const reportId = reports?.[0]?.id;
    const { error: resolveError } = await moderator.rpc("resolve_report", {
      p_report_id: reportId,
      p_status: "resolved",
    });
    expect(resolveError).not.toBeNull();
    expect(resolveError?.message ?? "").toMatch(/required/i);
  });
});
