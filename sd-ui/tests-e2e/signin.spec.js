/**
 * The sign-in is the public site's researcher sign-in (projarch.org/for-
 * researchers/login): the same shell, wall of legends, logo, words and form,
 * so a scholar meets one place whichever door they use. Signing in itself is
 * covered by claim.spec.
 *
 * What it keeps right:
 *   - the portrait wall is shown only with its credits link (a licence
 *     condition for the CC BY and BY-SA portraits);
 *   - the product is called what the public site calls it;
 *   - a wrong password is said in the site's words, and keeps the form.
 */

const { test, expect } = require("@playwright/test");

async function anonymousPage(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  return { context, page };
}

test("the sign-in page is the public site's", async ({ browser }) => {
  const { context, page } = await anonymousPage(browser);
  await page.goto("/login");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Inkvyn");
  await expect(page.getByText("Sign in with the scholar account your invitation set up.")).toBeVisible();
  await expect(page.locator(".authshell-brand-logo img")).toHaveAttribute("src", "/brand/archivyn-lockup-compact-on-dark.svg");
  await expect(page.locator(".authshell-wall .mission-tile").first()).toBeVisible();

  /* The wall's portraits come with their credits, on the public site. */
  const credits = page.getByRole("link", { name: "Portrait credits" }).first();
  await expect(credits).toHaveAttribute("href", /\/legal\/portrait-credits$/);
  await expect(page.getByRole("link", { name: "About Inkvyn" })).toHaveAttribute("href", "/");
  await context.close();
});

test("a wrong password is said plainly, and the form stays", async ({ browser }) => {
  const { context, page } = await anonymousPage(browser);
  await page.goto("/login");
  await page.getByLabel("Email").fill("nobody@example.edu");
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.locator(".authshell-banner.is-error")).toContainText("We couldn’t sign you in.");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByLabel("Email")).toHaveValue("nobody@example.edu");
  await context.close();
});

test("an empty form is stopped before it is sent", async ({ browser }) => {
  const { context, page } = await anonymousPage(browser);
  await page.goto("/login");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".authshell-banner.is-error")).toContainText("Enter the email and password of your scholar account.");
  await context.close();
});
