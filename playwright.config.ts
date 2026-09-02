import { defineConfig, devices } from "@playwright/test";

// The port is env-overridable so a run can target its own server instead of
// whatever already holds 3000 (another session's dev/prod server, say) --
// `reuseExistingServer` happily attaches to a stale build otherwise, and the
// failures that produces look like app bugs. Default is unchanged.
const port = Number(process.env.PLAYWRIGHT_PORT ?? 3000);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Deliberately just `next start`, not `build && start` — `verify:full`
    // already built the app via `verify`; this avoids building twice.
    command: `npm run start -- --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
