import { test, expect } from "@playwright/test";

test("sign-up page renders the registration form", async ({ page }) => {
  const response = await page.goto("/sign-up");
  expect(response?.status()).toBeLessThan(400);
  await expect(page.getByLabel(/email/i)).toBeVisible();
  await expect(page.getByLabel(/^password$/i)).toBeVisible();
});

test("sign-in page renders the sign-in form with links to sign-up and forgot-password", async ({
  page,
}) => {
  const response = await page.goto("/sign-in");
  expect(response?.status()).toBeLessThan(400);
  await expect(page.getByLabel(/email/i)).toBeVisible();
  const main = page.locator("#main-content");
  await expect(
    main.getByRole("link", { name: /forgot your password/i }),
  ).toHaveAttribute("href", "/forgot-password");
  await expect(main.getByRole("link", { name: /sign up/i })).toHaveAttribute(
    "href",
    "/sign-up",
  );
});

test("forgot-password page renders", async ({ page }) => {
  const response = await page.goto("/forgot-password");
  expect(response?.status()).toBeLessThan(400);
  await expect(page.getByLabel(/email/i)).toBeVisible();
});

test("reset-password without a recovery session shows a friendly expired-link state, not a broken form", async ({
  page,
}) => {
  const response = await page.goto("/reset-password");
  expect(response?.status()).toBeLessThan(400);
  await expect(
    page.getByRole("heading", { name: /link expired/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /request a new reset link/i }),
  ).toHaveAttribute("href", "/forgot-password");
});

test("visiting a protected contributor route while signed out redirects to sign-in with a safe next param", async ({
  page,
}) => {
  await page.goto("/account");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Faccount/);
});

test("an invalid auth callback link redirects to sign-in with a friendly error, never a crash", async ({
  page,
}) => {
  const response = await page.goto("/auth/callback");
  expect(response?.status()).toBeLessThan(400);
  await expect(page).toHaveURL(/\/sign-in\?error=invalid_link/);
  await expect(page.getByText(/invalid or has expired/i)).toBeVisible();
});
