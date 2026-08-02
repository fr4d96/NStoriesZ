#!/usr/bin/env node
// Wrapper for scripts/rls-test-cleanup.sql. Reuses the exact same
// fail-closed guard as tests/integration/story-rls.integration.test.ts (not
// a separate, weaker one), verifies the Supabase CLI is actually installed,
// then runs the scoped cleanup via `supabase db query --linked`. Never
// invoked automatically by anything else.
import { execFileSync } from "node:child_process";

function assertSafeToRun() {
  const required = [
    "SUPABASE_RLS_TEST_URL",
    "SUPABASE_RLS_TEST_PROJECT_REF",
    "SUPABASE_RLS_TEST_CONFIRM",
  ];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(`Refusing to run: missing env vars: ${missing.join(", ")}`);
    process.exit(1);
  }

  const url = process.env.SUPABASE_RLS_TEST_URL;
  const ref = process.env.SUPABASE_RLS_TEST_PROJECT_REF;
  if (!new URL(url).host.includes(ref)) {
    console.error(
      `Refusing to run: SUPABASE_RLS_TEST_URL (${url}) does not contain SUPABASE_RLS_TEST_PROJECT_REF (${ref}).`,
    );
    process.exit(1);
  }

  const expectedConfirm = `i-confirm-${ref}-is-a-disposable-dev-project`;
  if (process.env.SUPABASE_RLS_TEST_CONFIRM !== expectedConfirm) {
    console.error(
      `Refusing to run: SUPABASE_RLS_TEST_CONFIRM must exactly equal "${expectedConfirm}".`,
    );
    process.exit(1);
  }

  const fullTruncate = process.argv.includes("--full");
  if (
    fullTruncate &&
    process.env.SUPABASE_RLS_TEST_CONFIRM_FULL_TRUNCATE !==
      "yes-truncate-all-story-domain-data"
  ) {
    console.error(
      "Refusing to run --full: set SUPABASE_RLS_TEST_CONFIRM_FULL_TRUNCATE=yes-truncate-all-story-domain-data first, " +
        "and uncomment the truncate block in scripts/rls-test-cleanup.sql.",
    );
    process.exit(1);
  }

  console.log(`[rls-cleanup] target host: ${new URL(url).host} (ref ${ref})`);
}

function assertSupabaseCliInstalled() {
  try {
    const version = execFileSync("npx", ["supabase", "--version"], {
      encoding: "utf8",
    }).trim();
    console.log(`[rls-cleanup] supabase CLI version: ${version}`);
  } catch {
    console.error(
      "Refusing to run: `supabase` CLI is not available (npx supabase --version failed).",
    );
    process.exit(1);
  }
}

assertSafeToRun();
assertSupabaseCliInstalled();

execFileSync(
  "npx",
  [
    "supabase",
    "db",
    "query",
    "--file",
    "scripts/rls-test-cleanup.sql",
    "--linked",
  ],
  { stdio: "inherit" },
);
