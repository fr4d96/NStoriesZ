#!/usr/bin/env node
// Fail-closed cleanup for e2e/editorial-upload.spec.ts and
// e2e/content-import-body-size.spec.ts's own fixture data on the hosted
// linked project -- neither spec cleans up after itself, since a failed
// run's data is sometimes useful to inspect. Mirrors
// scripts/cleanup-abandoned-media-uploads.mjs's isolation pattern exactly:
// dedicated SUPABASE_MAINTENANCE_* env vars, loaded only via an explicit
// --env-file=.env.maintenance.local (never falls back to .env.local),
// project-ref-bound confirm string, dry-run by default (--execute required
// for anything destructive).
//
// Scoping: every story this cleanup touches has a slug starting with
// 'e2e-editorial-upload-' or 'e2e-body-size-' (the exact title prefixes
// both specs use), and every contributor it touches has a display_name
// starting with 'E2E Editorial Contributor ' or 'E2E Body-Size Contributor '
// -- both specs' own naming conventions, chosen specifically so this script
// can find them without touching the fixed rls-test-*/real account pool.
//
// Storage cleanup goes through the REAL Storage API
// (storage.from(bucket).remove([path])), never a raw `delete from
// storage.objects` row delete (round-6 plan R6-4) -- and each removal is
// verified via a follow-up storage.from(bucket).list() call confirming the
// path is actually gone, before any database row is deleted. Only once
// that is confirmed does this script delete the application rows, in the
// same dependency order scripts/rls-test-cleanup.sql already establishes
// for the story domain (every structural FK here is `on delete restrict`
// by design -- see docs/architecture.md "Deletion policy").
//
// Requires your EXPLICIT approval before ever being run with --execute
// against the hosted project, same as every other destructive/hosted
// operation in this repository.

import { createClient } from "@supabase/supabase-js";

const STORY_SLUG_PREFIXES = ["e2e-editorial-upload-", "e2e-body-size-"];
const CONTRIBUTOR_NAME_PREFIXES = [
  "E2E Editorial Contributor ",
  "E2E Body-Size Contributor ",
];
const PRIVATE_BUCKET = "story-images-private";
const PUBLIC_BUCKET = "story-images-public";

function assertSafeToRun() {
  const required = [
    "SUPABASE_MAINTENANCE_URL",
    "SUPABASE_MAINTENANCE_PROJECT_REF",
    "SUPABASE_MAINTENANCE_SERVICE_ROLE_KEY",
    "SUPABASE_MAINTENANCE_CONFIRM",
  ];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(`Refusing to run: missing env vars: ${missing.join(", ")}`);
    process.exit(1);
  }

  const url = process.env.SUPABASE_MAINTENANCE_URL;
  const ref = process.env.SUPABASE_MAINTENANCE_PROJECT_REF;
  if (!new URL(url).host.includes(ref)) {
    console.error(
      `Refusing to run: SUPABASE_MAINTENANCE_URL (${url}) does not contain SUPABASE_MAINTENANCE_PROJECT_REF (${ref}).`,
    );
    process.exit(1);
  }

  const expectedConfirm = `i-confirm-cleanup-${ref}`;
  if (process.env.SUPABASE_MAINTENANCE_CONFIRM !== expectedConfirm) {
    console.error(
      `Refusing to run: SUPABASE_MAINTENANCE_CONFIRM must exactly equal "${expectedConfirm}".`,
    );
    process.exit(1);
  }

  console.log(
    `[editorial-e2e-cleanup] target host: ${new URL(url).host} (ref ${ref})`,
  );
}

function slugOrClause() {
  return STORY_SLUG_PREFIXES.map((p) => `slug.like.${p}%`).join(",");
}

function contributorNameOrClause() {
  return CONTRIBUTOR_NAME_PREFIXES.map((p) => `display_name.like.${p}%`).join(
    ",",
  );
}

/** Removes one object and VERIFIES (via list(), not just the remove() call's return value) that it's actually gone. */
async function removeAndVerify(admin, bucket, objectPath) {
  const dir = objectPath.split("/").slice(0, -1).join("/");
  const filename = objectPath.split("/").at(-1);

  const { error: removeError } = await admin.storage
    .from(bucket)
    .remove([objectPath]);
  if (removeError) {
    console.warn(
      `    [warn] remove() failed for ${bucket}/${objectPath}: ${removeError.message}`,
    );
  }

  const { data: listing, error: listError } = await admin.storage
    .from(bucket)
    .list(dir);
  if (listError) {
    console.warn(
      `    [warn] could not verify deletion of ${bucket}/${objectPath}: ${listError.message}`,
    );
    return false;
  }
  const stillPresent = (listing ?? []).some((entry) => entry.name === filename);
  if (stillPresent) {
    console.error(
      `    [error] ${bucket}/${objectPath} still present after remove()!`,
    );
    return false;
  }
  console.log(`    verified gone: ${bucket}/${objectPath}`);
  return true;
}

async function main() {
  assertSafeToRun();

  const execute = process.argv.includes("--execute");
  console.log(
    `[editorial-e2e-cleanup] mode: ${execute ? "EXECUTE (destructive)" : "DRY RUN (report only)"}`,
  );

  const admin = createClient(
    process.env.SUPABASE_MAINTENANCE_URL,
    process.env.SUPABASE_MAINTENANCE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data: stories, error: storiesError } = await admin
    .from("stories")
    .select(
      "id, slug, contributor_id, current_draft_revision_id, published_revision_id",
    )
    .or(slugOrClause());
  if (storiesError) {
    console.error("Failed to query e2e fixture stories:", storiesError.message);
    process.exit(1);
  }
  console.log(
    `[editorial-e2e-cleanup] ${stories.length} fixture story/ies found.`,
  );
  for (const s of stories) console.log(`  - ${s.slug} (${s.id})`);

  if (stories.length === 0) {
    console.log("[editorial-e2e-cleanup] Nothing to clean up.");
    return;
  }

  const storyIds = stories.map((s) => s.id);

  const { data: revisions } = await admin
    .from("story_revisions")
    .select("id")
    .in("story_id", storyIds);
  const revisionIds = (revisions ?? []).map((r) => r.id);

  const { data: media } = await admin
    .from("story_media")
    .select(
      "id, private_storage_path, processed_private_storage_path, approved_public_storage_path",
    )
    .in("story_id", storyIds);
  console.log(
    `[editorial-e2e-cleanup] ${media?.length ?? 0} media row(s) found.`,
  );

  if (execute) {
    for (const m of media ?? []) {
      if (m.private_storage_path) {
        await removeAndVerify(admin, PRIVATE_BUCKET, m.private_storage_path);
      }
      if (m.processed_private_storage_path) {
        await removeAndVerify(
          admin,
          PRIVATE_BUCKET,
          m.processed_private_storage_path,
        );
      }
      if (m.approved_public_storage_path) {
        await removeAndVerify(
          admin,
          PUBLIC_BUCKET,
          m.approved_public_storage_path,
        );
      }
    }
  } else {
    for (const m of media ?? []) {
      for (const p of [
        m.private_storage_path,
        m.processed_private_storage_path,
        m.approved_public_storage_path,
      ]) {
        if (p) console.log(`  would remove: ${p}`);
      }
    }
  }

  if (!execute) {
    console.log(
      "[editorial-e2e-cleanup] Dry run complete -- no database rows deleted. Re-run with --execute to actually delete.",
    );
    return;
  }

  // Same dependency order scripts/rls-test-cleanup.sql establishes for the
  // story domain (every structural FK here is `on delete restrict`).
  await admin.from("story_reports").delete().in("story_id", storyIds);
  const { data: actions } = await admin
    .from("moderation_actions")
    .select("id")
    .in("revision_id", revisionIds);
  const actionIds = (actions ?? []).map((a) => a.id);
  if (actionIds.length > 0) {
    await admin
      .from("moderation_action_notes")
      .delete()
      .in("action_id", actionIds);
  }
  await admin
    .from("moderation_actions")
    .delete()
    .in("revision_id", revisionIds);
  await admin.from("editorial_actions").delete().in("story_id", storyIds);
  const { data: consents } = await admin
    .from("story_publication_consents")
    .select("id")
    .in("story_id", storyIds);
  const consentIds = (consents ?? []).map((c) => c.id);
  if (consentIds.length > 0) {
    await admin
      .from("story_publication_consent_notes")
      .delete()
      .in("consent_id", consentIds);
  }
  await admin
    .from("story_publication_consents")
    .delete()
    .in("story_id", storyIds);
  await admin
    .from("story_revision_media")
    .delete()
    .in("revision_id", revisionIds);
  await admin
    .from("story_revision_locations")
    .delete()
    .in("revision_id", revisionIds);
  await admin
    .from("story_revision_work_types")
    .delete()
    .in("revision_id", revisionIds);
  await admin
    .from("story_revision_tags")
    .delete()
    .in("revision_id", revisionIds);
  await admin
    .from("story_revision_editor_notes")
    .delete()
    .in("revision_id", revisionIds);
  await admin
    .from("story_media_public_copy_attempts")
    .delete()
    .in("revision_id", revisionIds);
  await admin
    .from("story_publication_attempts")
    .delete()
    .in("revision_id", revisionIds);
  await admin
    .from("stories")
    .update({ current_draft_revision_id: null, published_revision_id: null })
    .in("id", storyIds);
  await admin.from("story_revisions").delete().in("story_id", storyIds);
  await admin.from("story_media").delete().in("story_id", storyIds);
  await admin.from("stories").delete().in("id", storyIds);

  const { error: contributorsError } = await admin
    .from("contributors")
    .delete()
    .or(contributorNameOrClause());
  if (contributorsError) {
    console.error(
      "Failed to delete e2e fixture contributors:",
      contributorsError.message,
    );
  }

  console.log("[editorial-e2e-cleanup] Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
