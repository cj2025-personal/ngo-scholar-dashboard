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
  /* The pane stays in the tree while closed, hidden and slid away, so only a
     visible match counts. */
  await page.locator("[role=dialog]:visible, .ag-nudge:visible, .ws-right.is-agent:visible").first().waitFor();
  if (await agree.isVisible()) {
    await agree.click();
  } else if (await nudge.isVisible()) {
    await nudge.click();
    await page.locator("[role=dialog]:visible, .ws-right.is-agent:visible").first().waitFor();
    if (await agree.isVisible()) await agree.click();
  }
  await expect(rail).toBeVisible();
  /* The pane slides in. Wait until it has stopped moving before anything is
     measured or clicked, or a geometry check reads it mid-flight. */
  let prev = null;
  for (let i = 0; i < 30; i += 1) {
    const box = await rail.boundingBox();
    if (prev && box && prev.x === box.x && prev.y === box.y) break;
    prev = box;
    await page.waitForTimeout(50);
  }
}

module.exports = { openAgent };
