import { defineConfig } from "vitest/config";
import path from "node:path";

// Separate config for the RLS integration suite: real network calls to a
// real Supabase project, so it runs in the Node environment (not jsdom),
// serially (fileParallelism: false — several scenarios deliberately share
// the fixed test-account pool and the one-active-draft-per-story lock), with
// a longer timeout than the unit-test config. Never included in the default
// `vitest run` — see package.json's `test:rls` script.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["tests/integration/**/*.integration.test.ts"],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
