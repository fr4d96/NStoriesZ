import type { Page } from "@playwright/test";

/**
 * Scoped to <main> because components/site-header.tsx (added in
 * a172393, "session-aware header") now renders its own always-present
 * "Sign in" button. An unscoped `page.getByRole("button", { name: "Sign
 * in" })` on /sign-in matches both that header button and the real page's
 * submit button, which fails Playwright strict mode. Scoping to <main>
 * makes these locators unambiguous regardless of how the header evolves.
 */
export async function signInUi(page: Page, email: string, password: string) {
  await page.goto("/sign-in");
  const main = page.getByRole("main");
  await main.getByLabel("Email").fill(email);
  await main.getByLabel("Password").fill(password);
  await main.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"));
}
