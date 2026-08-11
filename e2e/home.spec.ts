import { test, expect } from "@playwright/test";

test("home page loads with title, heading, and working public nav", async ({
  page,
}) => {
  const response = await page.goto("/");
  expect(response?.status()).toBeLessThan(400);

  await expect(page).toHaveTitle(/Kakinotes/);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: /real stories from across aotearoa/i,
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

test("featured-story stack carousel is present and its cards link to real stories", async ({
  page,
}) => {
  await page.goto("/");

  const carousel = page.getByRole("region", {
    name: "Featured Working Holiday stories",
  });

  if ((await carousel.count()) === 0) {
    // No published stories in this environment's data -- the section is
    // conditionally rendered, so there's nothing further to assert.
    return;
  }

  await expect(carousel).toBeVisible();

  const readLink = carousel.getByRole("link", { name: /Read story/ }).first();
  const href = await readLink.getAttribute("href");
  expect(href).toMatch(/^\/stories\//);

  const storyResponse = await page.request.get(href!);
  expect(storyResponse.status()).toBeLessThan(400);

  // Keyboard operability: focus the stack and advance with the arrow key.
  const liveRegion = carousel.locator("[aria-live='polite']");
  const before = await liveRegion.textContent();
  await carousel.locator("[tabindex='0']").focus();
  await page.keyboard.press("ArrowRight");
  await expect(liveRegion).not.toHaveText(before ?? "");

  const nextButton = carousel.getByRole("button", { name: "Next stories" });
  await expect(nextButton).toBeEnabled();
});

test("destination quiz walks through to a result linking into /stories", async ({
  page,
}) => {
  await page.goto("/");

  const quizSection = page.locator("#match");
  if ((await quizSection.count()) === 0) {
    // Conditionally rendered when there are no published stories.
    return;
  }

  const quiz = quizSection;
  for (let i = 0; i < 4; i += 1) {
    const answers = quiz.getByTestId("quiz-answer");
    if ((await answers.count()) === 0) break;
    await answers.first().click();
  }

  const exploreLink = page.getByRole("link", { name: "Explore stories" });
  const browseAllLink = page.getByRole("link", { name: "Browse all stories" });
  await expect(exploreLink.or(browseAllLink)).toBeVisible();
});

test("region explorer links navigate into the filtered stories index", async ({
  page,
}) => {
  await page.goto("/");

  const heading = page.getByRole("heading", {
    name: "Explore New Zealand by region",
  });
  if ((await heading.count()) === 0) return;

  const section = heading.locator("xpath=ancestor::section[1]");
  const regionLink = section.getByRole("link").first();
  const href = await regionLink.getAttribute("href");
  expect(href).toMatch(/^\/stories\?region=/);

  const response = await page.request.get(href!);
  expect(response.status()).toBeLessThan(400);
});

test("theme toggle switches and persists across a reload", async ({ page }) => {
  await page.goto("/");

  const toggle = page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("button", { name: /Switch to (dark|light) mode/ });

  const initialTheme = await page.evaluate(
    () => document.documentElement.dataset.theme,
  );
  await toggle.click();
  const toggledTheme = await page.evaluate(
    () => document.documentElement.dataset.theme,
  );
  expect(toggledTheme).not.toBe(initialTheme);

  await page.reload();
  const persistedTheme = await page.evaluate(
    () => document.documentElement.dataset.theme,
  );
  expect(persistedTheme).toBe(toggledTheme);
});

test("staff routes fail closed with a not-found response", async ({ page }) => {
  for (const path of ["/editorial", "/moderation", "/admin"]) {
    const response = await page.request.get(path);
    expect(response.status()).toBe(404);
  }
});
