#!/usr/bin/env node
// Wrapper for scripts/rls-test-cleanup.sql. Reuses the exact same
// fail-closed guard as tests/integration/story-rls.integration.test.ts (not
// a separate, weaker one), verifies the Supabase CLI is actually installed,
// then runs the scoped cleanup via `supabase db query --linked`.
//
// Invoked automatically as npm's `posttest:rls` hook after a SUCCESSFUL
// `npm run test:rls` (2026-08-16), reversing this script's original
// "manual only" stance. Why the reversal: the suite publishes its fixture
// stories, and nothing removed them between runs, so the public /stories
// listing and landing page filled up with hundreds of `rls-test-%` stories
// (~95% of all public content at the point this was caught). "Remember to
// run cleanup" was not working.
//
// The safety properties that made the manual stance defensible are all
// still here and are what make the automation safe: the fail-closed guard
// below still runs on every invocation (a missing/mismatched confirm string
// still refuses), the deletes are still scoped to the `rls-test-%` slug
// prefix, and the full-truncate path still needs its own second env var.
// npm runs a `post<script>` hook ONLY when the script exited 0 — verified
// empirically, not assumed — so a FAILING test run deliberately leaves its
// fixtures in place for debugging, which is the behaviour you want.
// Running this by hand (`npm run test:rls:cleanup`) still works unchanged.
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
