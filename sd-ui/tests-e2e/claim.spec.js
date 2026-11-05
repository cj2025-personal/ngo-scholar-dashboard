/**
 * Claim: an invited scholar, who has no account and so no session, opens the
 * link an admin sent them and sets up their account.
 *
 * What it used to get wrong, and this keeps right:
 *   - the proxy treated every page but /login and /stories/* as private, so
 *     the claim link sent its only possible visitor — someone with no
 *     session — to the sign-in page, where they had no password to use.
 * The invitation is minted through the API's own internal route, the way the
 * admin portal does it, so the token is a real one.
 */

const { test, expect } = require("@playwright/test");

const { readState } = require("./stack");

const SERVICE_TOKEN = "e2e-service-token";
const CLAIMABLE_PROFILE = "e2e-claim-0003";
const PASSWORD = "Claim-e2e-Passw0rd!";

let state;
test.beforeAll(() => { state = readState(); });

async function issueInvite(request, email) {
  const res = await request.post(`${state.apiUrl}/api/internal/invites`, {
    headers: { "x-service-token": SERVICE_TOKEN, "x-service-name": "e2e-admin" },
    data: { profileId: CLAIMABLE_PROFILE, email, issuedBy: "e2e-admin@example.org" },
  });
  expect(res.status(), "issue invitation").toBe(201);
  return res.json();
}

test("a claim link opens without a session, and the account it makes can sign in", async ({ browser, request }) => {
  const email = `invited.${Date.now()}@example.edu`;
  const invite = await issueInvite(request, email);

  /* A fresh context: no cookies at all, as for someone opening an email. */
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(invite.claimPath);

  await expect(page).toHaveURL(new RegExp(`${invite.claimPath}$`));
  await expect(page.locator(".auth-card__identity-name")).toHaveText("Invited Scholar");

  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create my account" }).click();
  await expect(page.getByRole("heading", { name: "Your account is ready" })).toBeVisible();
  await expect(page).toHaveURL(/\/login(\?|$)/);

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/localhost:\d+\/$/);

  /* The link is spent: opened again, it says so instead of offering a form. */
  const again = await context.newPage();
  await again.goto(invite.claimPath);
  await expect(again.getByRole("heading", { name: "This invitation can’t be used" })).toBeVisible();
  await context.close();
});

test("a private page still sends someone with no session to sign in", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/editorial");
  await expect(page).toHaveURL(/\/login\?next=%2Feditorial$/);
  await context.close();
});
