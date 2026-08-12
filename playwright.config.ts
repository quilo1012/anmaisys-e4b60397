import { defineConfig } from "@playwright/test";

/**
 * Browser checks for the things jsdom cannot answer.
 *
 * The unit suite renders every screen, but jsdom performs no layout and loads no
 * Tailwind: it can tell you a button carries `min-h-11`, never that the button is
 * 44 pixels tall or that the page fits the width of a phone. These run in a real
 * Chromium at real viewport sizes and measure.
 *
 * They never reach the internet: every request to Supabase is intercepted in the
 * spec, so no fixture can touch the production database.
 */
export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/.results",
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:8080",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:8080",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
