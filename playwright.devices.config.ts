import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

/**
 * The same specs on three real device profiles: a desk, an Android phone and an iPhone.
 *
 * The default config runs Chromium at a phone's WIDTH only. A width is not a phone: with
 * no `isMobile`/`hasTouch` the page never answers `pointer: coarse`, so the rule in
 * index.css that grows every button to 48px never applied, and Safari's engine never ran
 * at all. On 01/11/2026 this config found the Performance date boxes losing their year at
 * 320px on a touch phone, which the default run had passed for months.
 *
 *   npx playwright install webkit      # once per machine
 *   PW_PORT=9111 npx playwright test -c playwright.devices.config.ts e2e/messages.spec.ts
 *
 * Specs that set their own `viewport` keep it; the device brings the engine, the touch
 * profile and the user agent.
 */
export default defineConfig({
  ...base,
  outputDir: "./e2e/.results/devices",
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "android-pixel7", use: { ...devices["Pixel 7"] } },
    { name: "iphone14-webkit", use: { ...devices["iPhone 14"] } },
  ],
});
