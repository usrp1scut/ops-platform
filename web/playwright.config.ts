import { defineConfig, devices } from "@playwright/test";

// Avoid pulling @types/node into the web package just for this single
// config file — declare the process slice we need.
declare const process: { env: Record<string, string | undefined> };

// The smoke suite assumes the Go API is running on :8080 (docker compose
// or `go run ./cmd/ops-api`). Playwright auto-starts the Vite dev server
// on a dedicated port (30174) so it does not clash with a developer's own
// `npm run dev` instance on 5173. The port is intentionally above 15000
// to avoid Windows' default dynamic port range (1024-15000), which can
// transiently reserve a low port from an outbound connection and make a
// fixed mid-range port flaky between runs.
//
// Override PLAYWRIGHT_BASE_URL to point at e.g. the embedded
// http://localhost:8080/portal/ build instead, which exercises the
// production SPA path. In that mode set PLAYWRIGHT_NO_WEBSERVER=1 so
// Playwright does not spin up Vite.

const isCI = !!process.env.CI;
const port = Number(process.env.PLAYWRIGHT_VITE_PORT || 30174);
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://localhost:${port}`;
const skipWebServer = process.env.PLAYWRIGHT_NO_WEBSERVER === "1";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  // Single worker so login state can be shared and tests don't race the
  // backend's session table.
  workers: 1,
  reporter: isCI ? [["list"], ["html", { open: "never" }]] : "list",
  outputDir: "test-results",
  use: {
    baseURL,
    trace: isCI ? "on-first-retry" : "retain-on-failure",
    screenshot: "only-on-failure",
    video: isCI ? "retain-on-failure" : "off",
  },
  projects: [
    {
      name: "chrome",
      use: {
        ...devices["Desktop Chrome"],
        // Use the system Chrome install instead of the bundled Chromium
        // download. The Chromium tarball cannot be reached from CN
        // networks without a mirror, and the smoke suite does not need
        // the exact pinned version.
        channel: "chrome",
      },
    },
  ],
  webServer: skipWebServer
    ? undefined
    : {
        command: `npm run dev -- --port ${port}`,
        url: `http://localhost:${port}`,
        reuseExistingServer: !isCI,
        timeout: 120_000,
        stdout: "ignore",
        stderr: "pipe",
      },
});
