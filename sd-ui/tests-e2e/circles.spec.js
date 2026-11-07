/**
 * Circles: a scholar starts a learning circle, sees what the text check found,
 * shares its class code, and sees which classes joined and how many read -
 * never who. The circles live in the learner app; its API is stood in for on
 * its own port, answering as it does, with the studio token and the scholar
 * named.
 */

const http = require("http");
const { test, expect } = require("@playwright/test");

const { readState, LEARNER_STUB_PORT, LEARNER_STUB_TOKEN } = require("./stack");

let state;
let stub;
const circles = [];
const seen = [];

const view = (c) => ({ ...c, classes: { active: c.connections.filter((k) => k.status === "active").length, pending: c.connections.filter((k) => k.status === "pending").length } });

test.beforeAll(async () => {
  state = readState();
  stub = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      if (req.headers["x-studio-token"] !== LEARNER_STUB_TOKEN) {
        res.statusCode = 401;
        return res.end("{}");
      }
      const body = raw ? JSON.parse(raw) : {};
      seen.push({ method: req.method, url: req.url, scholar: req.headers["x-scholar-profile"], body });
      if (req.method === "GET" && req.url === "/internal/studio/circles") return res.end(JSON.stringify({ circles: circles.map(view) }));
      if (req.method === "POST" && req.url === "/internal/studio/circles") {
        const asksContact = /email/i.test(body.purpose || "");
        const circle = {
          id: `64b0000000000000000000${String(circles.length + 10).padStart(2, "0")}`,
          name: body.name, purpose: body.purpose, bands: body.bands, featuredEditorialIds: body.featuredEditorialIds || [],
          classCode: "KQRT-4821", classCodeActive: true,
          status: asksContact ? "draft" : "open",
          review: asksContact
            ? { fit: false, unreachable: false, findings: [{ kind: "contact_outside", quote: "email me", explanation: "It asks learners to write to you." }] }
            : { fit: true, unreachable: false, findings: [] },
          suspendedReason: null, createdAt: new Date().toISOString(),
          placement: null, portals: [{ community: "black", name: "Black" }],
          minReport: 5, members: 23,
          connections: [
            { id: "l1", school: "Lincoln Elementary", className: "Room 12", grade: 4, status: "active", members: 23, since: new Date().toISOString() },
            { id: "l2", school: "Lincoln Elementary", className: "Room 3", grade: 3, status: "pending", members: null, since: new Date().toISOString() },
          ],
          stories: [{ editorialId: "s1", title: "How small antennas listen", readers: null }],
        };
        circles.unshift(circle);
        res.statusCode = 201;
        return res.end(JSON.stringify({ circle: view(circle) }));
      }
      /* A community's portal: the judge, stood in for, places a circle about Black inventors and declines one about antennas. */
      const placing = /^\/internal\/studio\/circles\/([^/]+)\/placement$/.exec(req.url);
      const placed = placing && circles.find((c) => c.id === placing[1]);
      if (placed && req.method === "POST") {
        if (body.community !== "black") {
          res.statusCode = 400;
          return res.end(JSON.stringify({ code: "NOT_A_PORTAL", message: "That community has no portal yet." }));
        }
        const fits = /inventors/i.test(placed.purpose);
        placed.placement = {
          community: "black", communityName: "Black", status: fits ? "placed" : "declined", shown: fits, withdrawn: false,
          reason: fits ? "It reads Black inventors' own work and lives." : "It is about antennas, with nothing particular to the Black community in it.",
          concerns: [], byArchivyn: false, unjudged: false, requestedAt: new Date().toISOString(), judgedAt: new Date().toISOString(),
        };
        return res.end(JSON.stringify({ circle: view(placed) }));
      }
      if (placed && req.method === "DELETE") {
        placed.placement = { ...placed.placement, withdrawn: true, shown: false };
        return res.end(JSON.stringify({ circle: view(placed) }));
      }
      const one = /^\/internal\/studio\/circles\/([^/]+)(\/code)?$/.exec(req.url);
      const circle = one && circles.find((c) => c.id === one[1]);
      if (circle && req.method === "GET" && !one[2]) return res.end(JSON.stringify({ circle: view(circle) }));
      if (circle && req.method === "POST" && one[2]) {
        if (typeof body.active === "boolean") circle.classCodeActive = body.active;
        return res.end(JSON.stringify({ circle: view(circle) }));
      }
      res.statusCode = 404;
      return res.end(JSON.stringify({ message: "Not found." }));
    });
  });
  await new Promise((resolve) => stub.listen(LEARNER_STUB_PORT, "localhost", resolve));
});

test.afterAll(async () => {
  await new Promise((resolve) => stub.close(resolve));
});

test.beforeEach(async ({ context }) => {
  await context.addCookies([{ name: "sd_session", value: state.token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }]);
});

test("a scholar starts a circle, is told what the check found, and shares an open circle's code", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 607 });
  await page.goto("/");
  await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Circles" }).click();
  await expect(page).toHaveURL(/\/circles$/);
  await expect(page.getByRole("heading", { name: "No circles yet" })).toBeVisible();

  /* One that asks learners to write to the scholar: kept a draft, and why. */
  await page.getByRole("button", { name: "Start a circle" }).click();
  await page.getByLabel("Name").fill("Ask me anything");
  await page.getByLabel("What the circle reads about").fill("Read the stories and email me your questions about antennas.");
  await page.getByRole("button", { name: "Start the circle" }).click();
  await expect(page.getByText("Draft: change the name or purpose")).toBeVisible();
  await expect(page.getByText(/asks learners to contact you/)).toBeVisible();

  /* One that is fine: open, with its code. */
  await page.getByRole("button", { name: "Start a circle" }).click();
  await page.getByLabel("Name").fill("Listening machines");
  await page.getByLabel("What the circle reads about").fill("Classes read how antennas pick one voice out of a crowd.");
  await page.getByLabel("Ages 12–14").check();
  await page.getByRole("button", { name: "Start the circle" }).click();
  await expect(page.locator(".cc-card").filter({ hasText: "Listening machines" }).getByText("Open")).toBeVisible();
  await expect(page.locator(".cc-card").filter({ hasText: "Listening machines" })).toContainText("KQRT-4821");

  const made = seen.find((s) => s.method === "POST" && s.body.name === "Listening machines");
  expect(made.scholar).toBe("e2e-profile-0001");
  expect(made.body.bands).toEqual(["ages_8_11", "ages_12_14"]);

  /* Its page: schools and classes, a small class's count withheld, never a name. */
  await page.getByRole("link", { name: "Listening machines" }).click();
  await expect(page.getByRole("heading", { name: "Who reads with you" })).toBeVisible();
  await expect(page.getByText("23 readers in 1 class or group.", { exact: false })).toBeVisible();
  await expect(page.getByText("Waiting for their school or organization")).toBeVisible();
  await expect(page.getByText("read by fewer than 5")).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("circle-1366x607.png"), fullPage: true });

  await page.getByRole("button", { name: "Switch it off" }).click();
  await expect(page.getByText(/Switched off: no new class or group can join/)).toBeVisible();
});

test("a scholar shows a circle in a community's portal, is told why another doesn't belong, and takes one out", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 607 });
  const start = async (name, purpose) => {
    await page.goto("/circles");
    await page.getByRole("button", { name: "Start a circle" }).click();
    await page.getByLabel("Name").fill(name);
    await page.getByLabel("What the circle reads about").fill(purpose);
    await page.getByRole("button", { name: "Start the circle" }).click();
    await page.getByRole("link", { name }).click();
    await expect(page.getByRole("heading", { name: "Community portal" })).toBeVisible();
  };

  await start("Inventors of the South Side", "Classes read about Black inventors in Chicago and the workshops they built.");
  await expect(page.getByText(/judged on what it is about, never on who leads it/)).toBeVisible();
  await page.getByRole("button", { name: "Show it in the Black portal" }).click();
  await expect(page.getByText("Shown in the Black portal.")).toBeVisible();
  await expect(page.getByText("It reads Black inventors' own work and lives.")).toBeVisible();
  const asked = seen.filter((s) => s.method === "POST" && /\/placement$/.test(s.url));
  expect(asked.at(-1).body).toEqual({ community: "black" });
  expect(asked.at(-1).scholar).toBe("e2e-profile-0001");
  await page.screenshot({ path: test.info().outputPath("circle-portal-1366x607.png"), fullPage: true });

  await page.getByRole("button", { name: "Take it out" }).click();
  await expect(page.getByText("You took it out of the Black portal.")).toBeVisible();
  expect(seen.some((s) => s.method === "DELETE" && /\/placement$/.test(s.url))).toBe(true);

  await start("Radio waves", "Classes read how antennas pick one voice out of a crowd.");
  await page.getByRole("button", { name: "Show it in the Black portal" }).click();
  await expect(page.getByText("Not shown in the Black portal.")).toBeVisible();
  await expect(page.getByText(/It is about antennas/)).toBeVisible();
  await expect(page.getByText(/the same circle gets the same answer/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Ask again" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Take it out" })).toHaveCount(0);
});
