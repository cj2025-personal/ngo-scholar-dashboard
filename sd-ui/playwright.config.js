// Browser suite for the composer: real Next.js app, real sd-api, in-memory
// MongoDB, fake model. `npm run test:e2e`.
//
// The API is started in global setup on a fixed port so the dev server can
// bake NEXT_PUBLIC_AUTH_API_URL at start; the two never depend on each other
// at boot, only per request.

const { defineConfig, devices } = require("@playwright/test");

const UI_PORT = Number(process.env.E2E_UI_PORT || 3103);
const API_PORT = Number(process.env.E2E_API_PORT || 4103);
/* localhost, not 127.0.0.1: the page is served from localhost, and a Lax
   session cookie travels only to the same site. Different ports on
   localhost are one site; localhost and 127.0.0.1 are not. This mirrors the
   deployment, where the portal and the API are sibling subdomains. */
const API_URL = `http://localhost:${API_PORT}`;

module.exports = defineConfig({
  testDir: "./tests-e2e",
  testMatch: /.*\.spec\.js/,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "tests-e2e/report" }]],
  outputDir: "tests-e2e/results",
  globalSetup: require.resolve("./tests-e2e/global-setup.js"),
  globalTeardown: require.resolve("./tests-e2e/global-teardown.js"),
  use: {
    baseURL: `http://localhost:${UI_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    navigationTimeout: 60_000,
    actionTimeout: 20_000,
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: `npx next dev -p ${UI_PORT}`,
    url: `http://localhost:${UI_PORT}/login`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: {
      AUTH_API_URL: API_URL,
      NEXT_PUBLIC_AUTH_API_URL: API_URL,
      NEXT_PUBLIC_SITE_URL: `http://localhost:${UI_PORT}`,
      AUTH_COOKIE_NAME: "sd_session",
    },
  },
});
