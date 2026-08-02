import { test, expect } from "@playwright/test";

test("home page loads with title, heading, and working public nav", async ({
  page,
}) => {
  const response = await page.goto("/");
  expect(response?.status()).toBeLessThan(400);

  await expect(page).toHaveTitle(/WHV Compass NZ/);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: /working holiday stories from new zealand/i,
    }),
  ).toBeVisible();

  const navLinks = [
    { name: "Stories", href: "/stories" },
    { name: "Contributors", href: "/contributors" },
    { name: "About", href: "/about" },
    { name: "Sign in", href: "/sign-in" },
    { name: "Sign up", href: "/sign-up" },
  ];

  for (const link of navLinks) {
    const anchor = page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", {
        name: link.name,
      });
    await expect(anchor).toHaveAttribute("href", link.href);

    const navResponse = await page.request.get(link.href);
    expect(navResponse.status()).toBeLessThan(400);
  }
});

test("staff routes fail closed with a not-found response", async ({ page }) => {
  for (const path of ["/editorial", "/moderation", "/admin"]) {
    const response = await page.request.get(path);
    expect(response.status()).toBe(404);
  }
});
