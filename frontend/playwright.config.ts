import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    browserName: "chromium",
    permissions: ["camera"],
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
    trace: "retain-on-failure",
  },
  webServer: [{
    command: "cd ../backend && uv run --frozen python browser_test_server.py",
    url: "http://127.0.0.1:8000/health",
    // Refuse to reuse a developer's API: browser tests write only to a disposable database.
    reuseExistingServer: false,
    timeout: 60000,
  }, {
    command: "npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  }],
});
