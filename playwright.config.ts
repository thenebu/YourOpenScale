import { defineConfig, devices } from "@playwright/test";

// Minimal config created by WP-16; WP-15 owns and extends it.
const port = Number(process.env.PORT ?? 8099);

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  reporter: "list",
  use: { baseURL: `http://127.0.0.1:${port}` },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run web:build && npm run dev",
    url: `http://127.0.0.1:${port}/offline`,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
