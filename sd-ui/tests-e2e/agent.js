/**
 * Open the agent on a story: the nudge if the rail is closed, and the terms
 * the first time. Idempotent, so a spec that runs after another has already
 * agreed finds the rail open and does nothing.
 */

const { expect } = require("@playwright/test");

async function openAgent(page) {
  const agree = page.getByRole("button", { name: "I agree" });
  const nudge = page.locator(".ag-nudge");
  const rail = page.locator(".ws-right.is-agent");

  /* A page opened with a paper or a job in hand asks for the terms at once;
     otherwise the nudge waits in the corner, or the rail is already open. */
  await page.locator("[role=dialog], .ag-nudge, .ws-right.is-agent").first().waitFor();
  if (await agree.isVisible()) {
    await agree.click();
  } else if (await nudge.isVisible()) {
    await nudge.click();
    await page.locator("[role=dialog], .ws-right.is-agent").first().waitFor();
    if (await agree.isVisible()) await agree.click();
  }
  await expect(rail).toBeVisible();
}

module.exports = { openAgent };
