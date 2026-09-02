import path from "node:path";
import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { signInUi } from "./helpers/sign-in";

/**
 * 2026-09-02: contributors can edit an ALREADY-PUBLISHED story.
 *
 * The thing worth proving here is not that a form saves — it is the promise
 * the confirm dialog makes: the published version stays live, unchanged, for
 * the whole time the update sits with a moderator, and is replaced only on
 * approval (Engineering Rule 11). So this spec watches the PUBLIC page
 * across the whole cycle, signed out, while the update moves through it.
 *
 * RUN AND PASSING against the live linked project:
 *
 *   node --env-file=.env.test.local node_modules/.bin/playwright test \
 *     e2e/contributor-story-update.spec.ts --workers=1
 *
 * Fixture pattern is the established one (e2e/moderation.spec.ts): the
 * lifecycle steps that are NOT under test (create/save/submit/approve) go
 * through signed-in RPC clients, and Playwright is spent only on what this
 * change actually added — the confirm-then-create "Edit" control in My
 * Stories, and what a reader sees while the update is in flight.
 *
 * Fixture hygiene: every title/slug leads with `rls-test`, so it falls
 * inside scripts/rls-test-cleanup.sql's existing `slug like 'rls-test-%'`
 * scope.
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
const MODERATOR_EMAIL = process.env.SUPABASE_RLS_TEST_MODERATOR_EMAIL;
const MODERATOR_PASSWORD = process.env.SUPABASE_RLS_TEST_MODERATOR_PASSWORD;

const hasAllCredentials = Boolean(
  URL &&
  KEY &&
  OWNER_EMAIL &&
  OWNER_PASSWORD &&
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

async function termsVersion(client: SupabaseClient): Promise<string> {
  const { data } = await client.rpc("current_terms_version");
  return typeof data === "string" && data.length > 0
    ? data
    : TERMS_VERSION_FALLBACK;
}

async function storyVersion(
  owner: SupabaseClient,
  storyId: string,
): Promise<number> {
  const { data, error } = await owner.rpc("get_my_story_with_draft", {
    p_story_id: storyId,
  });
  if (error || !data?.[0]) {
    throw new Error(
      `get_my_story_with_draft failed: ${error?.message ?? "no data"}`,
    );
  }
  return data[0].version as number;
}

async function submit(
  owner: SupabaseClient,
  revisionId: string,
  expectedVersion: number,
): Promise<void> {
  const { error } = await owner.rpc("submit_revision_with_consent", {
    p_revision_id: revisionId,
    p_expected_version: expectedVersion,
    p_confirmation_method: "account",
    p_publication_confirmed: true,
    p_expected_terms_version: await termsVersion(owner),
    p_image_rights_confirmed: false,
    p_identifiable_people_state: "not_applicable",
    p_editorial_assistance_confirmed: false,
  });
  if (error) {
    throw new Error(`submit_revision_with_consent failed: ${error.message}`);
  }
}

/** Approve = begin attempt + finalize; moderate_revision() refuses 'approve'. */
async function approve(
  moderator: SupabaseClient,
  revisionId: string,
): Promise<void> {
  const { data: attemptId, error: beginError } = await moderator.rpc(
    "begin_story_publication_attempt",
    { p_revision_id: revisionId },
  );
  if (beginError || !attemptId) {
    throw new Error(
      `begin_story_publication_attempt failed: ${beginError?.message ?? "no attempt id"}`,
    );
  }
  const { error } = await moderator.rpc("finalize_story_publication", {
    p_revision_id: revisionId,
    p_approval_attempt_id: attemptId,
  });
  if (error) {
    throw new Error(`finalize_story_publication failed: ${error.message}`);
  }
}

/** A published self-service story owned by the RLS-test owner account. */
async function publishFixtureStory(
  owner: SupabaseClient,
  moderator: SupabaseClient,
  title: string,
): Promise<{ storyId: string; slug: string }> {
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

  const { error: saveError } = await owner.rpc("save_revision_draft", {
    p_revision_id: revisionId,
    p_expected_version: 1,
    p_title: title,
    p_excerpt: "The first published version.",
    p_content_json: [
      {
        type: "paragraph",
        text: [{ text: "The version readers can see today." }],
      },
    ],
  });
  if (saveError) {
    throw new Error(`save_revision_draft failed: ${saveError.message}`);
  }

  await submit(owner, revisionId, await storyVersion(owner, storyId));
  await approve(moderator, revisionId);

  const { data: stories, error: listError } =
    await owner.rpc("list_my_stories");
  if (listError)
    throw new Error(`list_my_stories failed: ${listError.message}`);
  const row = (stories ?? []).find(
    (s: { id: string }) => s.id === storyId,
  ) as unknown as { slug: string } | undefined;
  if (!row) throw new Error("published fixture story not found in My Stories");

  return { storyId, slug: row.slug };
}

test.describe("contributor edits a published story", () => {
  test.skip(
    !hasAllCredentials,
    "Requires SUPABASE_RLS_TEST_* owner + moderator credentials in .env.test.local — see docs/architecture.md 'RLS integration test setup'.",
  );

  test("the published version stays live until the update is approved", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const stamp = Date.now();
    const originalTitle = `rls-test update e2e ${stamp} original`;
    const updatedTitle = `rls-test update e2e ${stamp} corrected`;

    const owner = await signInRpcClient(OWNER_EMAIL!, OWNER_PASSWORD!);
    const moderator = await signInRpcClient(
      MODERATOR_EMAIL!,
      MODERATOR_PASSWORD!,
    );
    const { storyId, slug } = await publishFixtureStory(
      owner,
      moderator,
      originalTitle,
    );

    // Signed out: this is what a reader sees before anything is edited.
    await page.goto(`/stories/${slug}`);
    await expect(
      page.getByRole("heading", { level: 1, name: originalTitle }),
    ).toBeVisible();

    // The control this change added. It creates nothing until answered.
    await signInUi(page, OWNER_EMAIL!, OWNER_PASSWORD!);
    await page.goto("/my-stories");
    await page.getByRole("button", { name: `Edit ${originalTitle}` }).click();
    await expect(
      page.getByRole("heading", { name: "Make changes to this story?" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Yes, edit it" }).click();
    await page.waitForURL(`**/stories/${storyId}/edit`);

    // The new draft exists and is the contributor's to edit. Writing the
    // update itself goes through the RPCs (the editor form has its own
    // coverage); what matters here is what happens to the LIVE story.
    const { data: draftRows } = await owner.rpc("get_my_story_with_draft", {
      p_story_id: storyId,
    });
    const draft = draftRows![0];
    expect(draft.revision_status).toBe("draft");
    expect(draft.lifecycle_status).toBe("published");

    await owner.rpc("save_revision_draft", {
      p_revision_id: draft.revision_id,
      p_expected_version: draft.version,
      p_title: updatedTitle,
      p_excerpt: "The corrected version.",
      p_content_json: [
        { type: "paragraph", text: [{ text: "Now with the fix in it." }] },
      ],
    });
    await submit(owner, draft.revision_id, await storyVersion(owner, storyId));

    // THE POINT OF ALL THIS: submitted, waiting on a moderator, and the
    // public page is still the old story, untouched.
    await page.context().clearCookies();
    await page.goto(`/stories/${slug}`);
    await expect(
      page.getByRole("heading", { level: 1, name: originalTitle }),
    ).toBeVisible();
    await expect(page.getByText(updatedTitle)).toHaveCount(0);

    // And My Stories says so, rather than leaving the contributor guessing.
    await signInUi(page, OWNER_EMAIL!, OWNER_PASSWORD!);
    await page.goto("/my-stories");
    await expect(page.getByText("Update in review").first()).toBeVisible();

    // Approved: now, and only now, the replacement goes live.
    await approve(moderator, draft.revision_id);
    await page.context().clearCookies();
    await page.goto(`/stories/${slug}`);
    await expect(
      page.getByRole("heading", { level: 1, name: updatedTitle }),
    ).toBeVisible();
  });

  test("the tag box types freely, and only the dropdown button opens the list", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const title = `rls-test tag dropdown e2e ${Date.now()}`;
    const owner = await signInRpcClient(OWNER_EMAIL!, OWNER_PASSWORD!);
    const { data: draft, error } = await owner.rpc(
      "create_self_service_draft",
      {
        p_title: title,
      },
    );
    if (error || !draft?.[0]) {
      throw new Error(
        `create_self_service_draft failed: ${error?.message ?? "no data"}`,
      );
    }
    const storyId: string = draft[0].story_id ?? draft[0].id;

    await signInUi(page, OWNER_EMAIL!, OWNER_PASSWORD!);
    await page.goto(`/stories/${storyId}/edit?step=places`);

    const tagBox = page.getByLabel("Add a tag");
    await tagBox.fill("Ferry to Picton");

    // The reported bug: a suggestion list appearing over the field while a
    // tag is being typed. Nothing opens now, and Enter commits the label.
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await tagBox.press("Enter");
    await expect(
      page.getByRole("button", { name: "Remove tag Ferry to Picton" }),
    ).toBeVisible();

    // The list is behind its own button, and picking from it adds a chip.
    await page.getByRole("button", { name: /choose tags/i }).click();
    const list = page.getByRole("listbox", { name: "Suggested tags" });
    await expect(list).toBeVisible();
    const firstSuggestion = list.getByRole("button").first();
    const suggestionName = (await firstSuggestion.textContent())!.trim();
    await firstSuggestion.click();
    await expect(
      page.getByRole("button", { name: `Remove tag ${suggestionName}` }),
    ).toBeVisible();
  });
});
