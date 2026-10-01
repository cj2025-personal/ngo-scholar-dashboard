/**
 * Kivyn: the agent's one name and one face, drawn doing what the agent is
 * really doing.
 *
 * The drawing is one module, and the files handed to designers are written
 * from it, so the two are compared byte for byte. Every step the drafting
 * pipeline and the edit agent report must be drawn as something, so the
 * steps are read from the API's own source. In the browser: the nudge and
 * the pane name Kivyn and nothing else; a step under way is drawn as itself
 * while it lasts and Kivyn rests once it is over; and a reader who asked for
 * less motion sees the poses still.
 */

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { test, expect } = require("@playwright/test");

const { openAgent } = require("./agent");
const { readState } = require("./stack");

const UI = path.resolve(__dirname, "..");
const API = path.resolve(UI, "..", "sd-api");
const load = (rel) => import(pathToFileURL(path.join(UI, rel)).href);

test("the brand files are the drawing the app renders", async () => {
  const { brandFiles } = await load("src/lib/kivyn/art.mjs");
  const files = brandFiles();
  const dir = path.join(UI, "public", "brand", "kivyn");
  expect(fs.readdirSync(dir).filter((f) => f.endsWith(".svg")).sort(), "run npm run brand:kivyn").toEqual(Object.keys(files).sort());
  for (const [name, svg] of Object.entries(files)) {
    expect(fs.readFileSync(path.join(dir, name), "utf8"), `${name} differs from the drawing: run npm run brand:kivyn`).toBe(svg);
  }
});

test("every step the agent reports is drawn as something", async () => {
  const { STEP_POSES, TOOL_POSES, POSES } = await load("src/lib/kivyn/pose.mjs");
  /* latin1: the job service carries NUL bytes in one template, and a step name is ASCII either way. */
  const read = (rel) => fs.readFileSync(path.join(API, rel), "latin1");
  const all = (text, re) => [...text.matchAll(re)].map((m) => m[1]);
  const steps = new Set([
    ...all(read("src/lib/draftGraph.js"), /progress\("([a-z_]+)"/g),
    ...all(read("src/services/draftJob.service.js"), /step: "([a-z_]+)"/g),
    ...all(read("src/services/storyAgent.service.js"), /onProgress\(\{ step: "([a-z_]+)"/g),
    ...all(fs.readFileSync(path.join(UI, "src", "lib", "drafting.js"), "utf8").split("const STEP_LABELS = {")[1].split("};")[0], /^\s+([a-z_]+):/gm),
  ]);
  expect(steps.size).toBeGreaterThan(15);
  for (const step of steps) {
    if (step === "tool" || step === "tool_done") continue; // drawn by the tool, below
    expect(STEP_POSES[step], `the step "${step}" has no pose`).toBeTruthy();
  }
  const { TOOL_DECLARATIONS } = require(path.join(API, "src", "lib", "storyAgent.js"));
  for (const tool of TOOL_DECLARATIONS.map((d) => d.name)) expect(TOOL_POSES[tool], `the tool "${tool}" has no pose`).toBeTruthy();
  for (const pose of [...Object.values(STEP_POSES), ...Object.values(TOOL_POSES)]) expect(POSES).toContain(pose);
});

test.describe("in the studio", () => {
  test.beforeEach(async ({ context }) => {
    const state = readState();
    await context.addCookies([{ name: "sd_session", value: state.token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
  });

  test("one name and one face: the card, the nudge, the pane, and who it is", async ({ page }) => {
    await page.goto("/editorial/new");
    /* Wide: Kivyn's card, greeting the scholar by name. */
    const card = page.locator(".kv-companion");
    await expect(card.locator(".kvc-name")).toContainText("I’m Kivyn");
    await expect(card.locator(".kv-actor svg.kv")).toHaveAttribute("data-pose", "neutral");
    /* Narrow: the nudge says the same name with the same face. */
    await page.setViewportSize({ width: 1024, height: 768 });
    const nudge = page.locator(".ag-nudge");
    await expect(nudge).toBeVisible();
    await expect(nudge).toHaveText("Kivyn");
    await expect(nudge.locator("svg.kv")).toHaveAttribute("data-pose", "neutral");
    await expect(nudge.locator("svg.kv")).toHaveAttribute("aria-hidden", "true");
    await page.setViewportSize({ width: 1280, height: 720 });

    await openAgent(page);
    const head = page.locator(".ws-right.is-agent .ws-agent-head");
    await expect(head.locator(".ws-identity b")).toHaveText("Kivyn");
    await expect(head.locator(".kv-actor > svg.kv")).toBeVisible();
    /* Each message has Kivyn's face, still: only the one showing the work moves. */
    const face = page.locator(".ch-msg.is-agent > svg.kv").first();
    await expect(face).toBeVisible();
    await expect(face).not.toHaveClass(/kv-live/);

    await head.locator(".ws-identity").click();
    const about = page.locator(".ws-about");
    await expect(about.locator(".ws-about-name")).toHaveText("Kivyn");
    await expect(about.getByText("What Kivyn may do")).toBeVisible();
    /* One character for every scholar: nothing here renames it or changes its face. */
    await expect(about.locator("input, .rc-face-pick, .rc-tone-pick")).toHaveCount(0);
    await about.getByRole("button", { name: "Back to Kivyn" }).click();
    await expect(about).toHaveCount(0);
  });

  test("Kivyn is drawn doing the step under way, and rests once it is over", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/editorial/new");
    await openAgent(page);
    const head = page.locator(".ws-right.is-agent .ws-agent-head");
    const headKivyn = head.locator(".kv-actor > svg.kv");
    await expect(headKivyn).toHaveAttribute("data-pose", "neutral");

    /* Held at the network, so the step can be seen while it is the step. */
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    await page.route("**/api/drafting/converse", async (route) => { await held; await route.continue(); });
    const box = page.getByPlaceholder(/Describe the article you want/);
    await box.fill("I want to write from one of my papers");
    await box.press("Enter");
    const working = page.locator(".ch-msg.is-working .kv-actor > svg.kv");
    await expect(working).toHaveAttribute("data-pose", "reading");
    await expect(working).toHaveClass(/kv-live/);
    await expect(headKivyn).toHaveAttribute("data-pose", "reading");
    await expect(head.locator(".rc-status")).toHaveText("Reading what you said…");
    release();
    await expect(page.locator(".ch-msg.is-papers")).toBeVisible();
    await expect(working).toHaveCount(0);
    await expect(headKivyn).toHaveAttribute("data-pose", "neutral");
    await page.unroute("**/api/drafting/converse");

    /* An outline is work done: a moment, then rest. While it waits the plan is the page and the pane has no head, so the moment is on the outline's own face. */
    await page.locator(".ch-msg.is-papers .ch-paper").filter({ hasText: "Adaptive nulling" }).click();
    await box.fill("Walk through how the array was tried in the field, written for teenagers");
    await box.press("Enter");
    await expect(page.locator(".ch-msg.is-outline").first()).toBeVisible({ timeout: 60_000 });
    const outlineFace = page.locator(".ch-msg.is-outline > svg.kv").first();
    await expect(outlineFace).toHaveAttribute("data-pose", /^(done|cant-answer)$/);
    await expect(outlineFace).toHaveAttribute("data-pose", "neutral", { timeout: 10_000 });
    await expect(outlineFace).not.toHaveClass(/kv-live/);
  });

  test("a tap gets a reaction and then Kivyn is itself again; while it works, it stays on the work", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/editorial/new");
    await openAgent(page);
    const actor = page.locator(".ws-right.is-agent .ws-agent-head .kv-actor");
    const kivyn = actor.locator("svg.kv");
    await expect(actor).toHaveAccessibleName("Say hello to Kivyn");
    await actor.click();
    await expect(kivyn).toHaveAttribute("data-pose", "wave");
    await expect(kivyn).toHaveClass(/kv-react-wave/);
    await expect(actor.locator(".kv-emote")).toHaveAttribute("data-emote", "hi");
    /* Painted in Kivyn's colours, not the browser's black: a white bubble with a navy line. */
    await expect(actor.locator(".kv-emote .kv-card")).toHaveCSS("fill", "rgb(255, 255, 255)");
    await expect(actor.locator(".kv-emote .kv-card")).toHaveCSS("stroke", "rgb(30, 58, 138)");
    await expect(actor.locator(".sr-only")).toHaveText("Kivyn waves hello.");
    /* The next tap is the next reaction, and a keyboard taps it too. */
    await actor.focus();
    await page.keyboard.press("Enter");
    await expect(kivyn).toHaveAttribute("data-pose", "wink");
    await expect(actor.locator(".kv-emote")).toHaveAttribute("data-emote", "heart");
    /* Then it is over: Kivyn as it was, no bubble, and the tap opened nothing. */
    await expect(kivyn).toHaveAttribute("data-pose", "neutral", { timeout: 5_000 });
    await expect(actor.locator(".kv-emote")).toHaveCount(0);
    await expect(page.locator(".ws-about")).toHaveCount(0);

    /* Working: the tap is acknowledged, and the drawing stays the step under way. */
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    await page.route("**/api/drafting/converse", async (route) => { await held; await route.continue(); });
    const box = page.getByPlaceholder(/Describe the article you want/);
    await box.fill("I want to write from one of my papers");
    await box.press("Enter");
    const working = page.locator(".ch-msg.is-working .kv-actor");
    await expect(working.locator("svg.kv")).toHaveAttribute("data-pose", "reading");
    await expect(working).toHaveAccessibleName("Kivyn, working");
    await working.click();
    await expect(working.locator(".kv-emote")).toHaveAttribute("data-emote", "wait");
    await expect(working.locator("svg.kv")).toHaveAttribute("data-pose", "reading");
    await expect(working.locator(".sr-only")).toHaveText("Kivyn is still working on it.");
    release();
    await expect(page.locator(".ch-msg.is-papers")).toBeVisible();
    await page.unroute("**/api/drafting/converse");
  });

  test("a paper chosen on Kivyn's card opens the pane on it, and writing by hand steps the card back", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/editorial/new");
    const card = page.locator(".kv-companion");
    const paper = card.locator(".kvc-paper").first();
    await expect(paper).toBeVisible();
    const title = (await paper.locator(".kvc-paper-title").innerText()).trim();
    await paper.click();
    const agree = page.getByRole("button", { name: "I agree" });
    if (await agree.isVisible().catch(() => false)) await agree.click();
    /* The pane opens in the card's place, with the paper said as if tapped there, and Kivyn takes it up. */
    await expect(page.locator(".ws-right.is-agent")).toBeVisible();
    await expect(card).toHaveCount(0);
    await expect(page.locator(".ch-msg.is-user").last()).toContainText(`Use “${title.replace(/…$/, "")}`);
    await expect(page.locator(".ch-msg.is-agent").last()).toContainText("Working from");
    await expect(page.locator(".ch-context")).toContainText(title.replace(/…$/, "").slice(0, 20));
    await page.getByRole("button", { name: "Close Kivyn" }).click();

    /* Writing by hand: the card steps back to a line and a button. */
    await expect(card).toBeVisible();
    await page.locator(".block-editor-surface").first().click();
    await page.keyboard.type("A paragraph written by hand.");
    await expect(page.locator(".kv-companion.is-compact")).toBeVisible();
    await expect(page.locator(".kv-companion.is-compact .kvc-cta")).toHaveText(/Ask Kivyn/);
  });

  test("asked for less motion, Kivyn holds its pose still, and a tap still answers", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/editorial/new");
    const eye = page.locator(".kv-companion svg.kv .kv-p-eye").first();
    await expect(eye).toHaveCSS("animation-name", "none");
    await openAgent(page);
    const actor = page.locator(".ws-right.is-agent .ws-agent-head .kv-actor");
    await actor.click();
    /* The reaction's pose and its bubble, without the movement. */
    await expect(actor.locator("svg.kv")).toHaveAttribute("data-pose", "wave");
    await expect(actor.locator(".kv-p-arm-wave")).toHaveCSS("animation-name", "none");
    await expect(actor.locator(".kv-emote")).toHaveCSS("animation-name", "kv-emote-still");
    /* Once it is over and motion is allowed again, Kivyn blinks as it rests. */
    await expect(actor.locator("svg.kv")).toHaveAttribute("data-pose", "neutral", { timeout: 5_000 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect(actor.locator(".kv-p-eye").first()).toHaveCSS("animation-name", "kv-blink");
  });
});
