#!/usr/bin/env node
// Fail-closed maintenance script for abandoned/orphaned media (Prompt 4).
// Two candidate sets, both SELECTed via the service-role client (never a
// raw `delete from storage.objects` — actual object deletion always goes
// through the Supabase Storage API), then reconciled via the two narrow,
// service_role-only RPCs (maintenance_cancel_abandoned_reservation /
// maintenance_resolve_orphaned_copy_attempt) so every database mutation
// respects the same DB-level invariants as every other path in the system.
//
// - story_media rows still `pending_upload` after 24h (far beyond any
//   realistic single upload duration).
// - story_media_public_copy_attempts rows still unresolved after 1h.
//
// Dry-run by default. Pass --execute to actually delete anything. Requires
// dedicated SUPABASE_MAINTENANCE_* env vars, loaded only via an explicit
// --env-file=.env.maintenance.local — never falls back to the app's
// runtime .env.local, mirroring the existing SUPABASE_RLS_TEST_* isolation
// pattern in scripts/run-rls-cleanup.mjs.

import { createClient } from "@supabase/supabase-js";

const BATCH_SIZE = 100;
const PENDING_UPLOAD_AGE_HOURS = 24;
const UNRESOLVED_COPY_ATTEMPT_AGE_HOURS = 1;

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

  console.log(`[media-cleanup] target host: ${new URL(url).host} (ref ${ref})`);
}

async function main() {
  assertSafeToRun();

  const execute = process.argv.includes("--execute");
  console.log(
    `[media-cleanup] mode: ${execute ? "EXECUTE (destructive)" : "DRY RUN (report only)"}`,
  );

  const admin = createClient(
    process.env.SUPABASE_MAINTENANCE_URL,
    process.env.SUPABASE_MAINTENANCE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const pendingCutoff = new Date(
    Date.now() - PENDING_UPLOAD_AGE_HOURS * 60 * 60 * 1000,
  ).toISOString();
  const { data: pendingUploads, error: pendingError } = await admin
    .from("story_media")
    .select("id, private_storage_path, created_at")
    .eq("processing_state", "pending_upload")
    .lt("created_at", pendingCutoff)
    .limit(BATCH_SIZE);
  if (pendingError) {
    console.error(
      "Failed to query abandoned pending uploads:",
      pendingError.message,
    );
    process.exit(1);
  }

  console.log(
    `[media-cleanup] ${pendingUploads.length} abandoned pending upload(s) found.`,
  );
  for (const row of pendingUploads) {
    console.log(
      `  - story_media ${row.id} (reserved ${row.created_at}) at ${row.private_storage_path}`,
    );
    if (!execute) continue;

    const { error: removeError } = await admin.storage
      .from("story-images-private")
      .remove([row.private_storage_path]);
    if (removeError) {
      console.warn(
        `    [warn] could not delete storage object (may not exist): ${removeError.message}`,
      );
    }
    const { error: rpcError } = await admin.rpc(
      "maintenance_cancel_abandoned_reservation",
      { p_media_id: row.id },
    );
    if (rpcError) {
      console.error(
        `    [error] maintenance_cancel_abandoned_reservation failed: ${rpcError.message}`,
      );
    } else {
      console.log("    cleaned up.");
    }
  }

  const copyCutoff = new Date(
    Date.now() - UNRESOLVED_COPY_ATTEMPT_AGE_HOURS * 60 * 60 * 1000,
  ).toISOString();
  const { data: orphanedCopies, error: copyError } = await admin
    .from("story_media_public_copy_attempts")
    .select("id, media_id, public_path, status, created_at")
    .is("resolved_at", null)
    .lt("created_at", copyCutoff)
    .limit(BATCH_SIZE);
  if (copyError) {
    console.error("Failed to query orphaned copy attempts:", copyError.message);
    process.exit(1);
  }

  console.log(
    `[media-cleanup] ${orphanedCopies.length} unresolved copy attempt(s) found.`,
  );
  for (const row of orphanedCopies) {
    console.log(
      `  - copy attempt ${row.id} (media ${row.media_id}, status ${row.status}) at ${row.public_path}`,
    );
    if (!execute) continue;

    if (row.status === "verified" || row.status === "copied") {
      const { error: removeError } = await admin.storage
        .from("story-images-public")
        .remove([row.public_path]);
      if (removeError) {
        console.warn(
          `    [warn] could not delete public object (may not exist): ${removeError.message}`,
        );
      }
    }
    const { error: rpcError } = await admin.rpc(
      "maintenance_resolve_orphaned_copy_attempt",
      {
        p_copy_attempt_id: row.id,
      },
    );
    if (rpcError) {
      console.error(
        `    [error] maintenance_resolve_orphaned_copy_attempt failed: ${rpcError.message}`,
      );
    } else {
      console.log("    resolved.");
    }
  }

  if (!execute) {
    console.log(
      "[media-cleanup] Dry run complete. Re-run with --execute to actually delete/resolve.",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
