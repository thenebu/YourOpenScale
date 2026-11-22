import { defineConfig, devices } from "@playwright/test";

// PORT overrides 8099 when it is busy (e.g. `PORT=8231 npm run e2e`).
const port = Number(process.env.PORT ?? 8099);
const base = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  reporter: "list",
  timeout: 60_000,
  use: { baseURL: base, ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
  projects: [
    { name: "light", use: { colorScheme: "light" } },
    { name: "dark", use: { colorScheme: "dark" } },
  ],
  webServer: {
    command: "npm run web:build && npm run dev",
    url: `${base}/offline`,
    reuseExistingServer: true,
    timeout: 180_000,
    env: { PORT: String(port) },
  },
});
