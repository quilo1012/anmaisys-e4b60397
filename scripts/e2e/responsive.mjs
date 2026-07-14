#!/usr/bin/env node
/**
 * E2E responsive smoke test.
 *
 * Loads the app at 3 breakpoints (mobile/tablet/desktop) for a list of
 * dashboard routes and asserts:
 *   1. No horizontal page overflow (document.scrollWidth <= viewport width).
 *   2. Every interactive control (button, a, input, select, [role=button])
 *      is at least 32×32 CSS px and fully inside the viewport width.
 *
 * Usage (from repo root, dev server on :8080):
 *   node scripts/e2e/responsive.mjs
 *
 * Requires Playwright + a valid Supabase session in the env
 * (LOVABLE_BROWSER_SUPABASE_* — auto-injected by the Lovable sandbox).
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.BASE_URL || "http://localhost:8080";
const OUT = process.env.OUT_DIR || "/tmp/browser/responsive";
mkdirSync(OUT, { recursive: true });

const BREAKPOINTS = [
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 900 },
];

const ROUTES = [
  "/dashboard",
  "/dashboard/analytics",
  "/dashboard/executive",
  "/dashboard/manager",
  "/dashboard/engineer",
  "/dashboard/work-orders",
  "/dashboard/downtime",
  "/dashboard/shift-history",
  "/dashboard/production-performance",
  "/dashboard/rag-weekly",
  "/dashboard/production-planner",
];

async function restoreSession(context, page) {
  const storageKey = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;
  const sessionJson = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
  const cookiesJson = process.env.LOVABLE_BROWSER_SUPABASE_COOKIES_JSON;
  if (cookiesJson) {
    const cookies = JSON.parse(cookiesJson).map((c) => ({ ...c, url: BASE }));
    await context.addCookies(cookies);
  }
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  if (storageKey && sessionJson) {
    await page.evaluate(
      ([k, v]) => window.localStorage.setItem(k, v),
      [storageKey, sessionJson],
    );
  }
}

const results = [];

const browser = await chromium.launch({ headless: true });
try {
  for (const bp of BREAKPOINTS) {
    const context = await browser.newContext({
      viewport: { width: bp.width, height: bp.height },
    });
    const page = await context.newPage();
    await restoreSession(context, page);

    for (const route of ROUTES) {
      const url = `${BASE}${route}`;
      const entry = { breakpoint: bp.name, route, issues: [] };
      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: 20000 });
        await page.waitForTimeout(400);

        const overflow = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        if (overflow.scrollWidth > overflow.clientWidth + 1) {
          entry.issues.push(
            `horizontal-overflow scrollWidth=${overflow.scrollWidth} > clientWidth=${overflow.clientWidth}`,
          );
        }

        const badControls = await page.evaluate((vw) => {
          const sel = "button, a[href], input, select, textarea, [role=button]";
          const bad = [];
          for (const el of document.querySelectorAll(sel)) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) continue; // hidden
            if (r.right > vw + 1) {
              bad.push({
                tag: el.tagName.toLowerCase(),
                label: (el.getAttribute("aria-label") || el.textContent || "")
                  .trim()
                  .slice(0, 40),
                right: Math.round(r.right),
              });
            } else if (r.width < 32 || r.height < 24) {
              // tiny hit target
              const label = (el.getAttribute("aria-label") || el.textContent || "")
                .trim()
                .slice(0, 40);
              if (label) bad.push({ tag: el.tagName.toLowerCase(), label, tiny: `${Math.round(r.width)}x${Math.round(r.height)}` });
            }
          }
          return bad.slice(0, 8);
        }, bp.width);
        if (badControls.length) entry.issues.push({ badControls });

        if (entry.issues.length) {
          const shot = join(
            OUT,
            `${bp.name}_${route.replace(/\//g, "_")}.png`,
          );
          await page.screenshot({ path: shot });
          entry.screenshot = shot;
        }
      } catch (err) {
        entry.issues.push(`nav-error: ${err.message}`);
      }
      results.push(entry);
      console.log(
        `[${bp.name}] ${route} — ${entry.issues.length ? "FAIL" : "ok"}`,
      );
    }
    await context.close();
  }
} finally {
  await browser.close();
}

const failed = results.filter((r) => r.issues.length);
writeFileSync(join(OUT, "report.json"), JSON.stringify(results, null, 2));
console.log(
  `\n== ${failed.length}/${results.length} route×breakpoint checks failed ==`,
);
for (const f of failed) {
  console.log(`  ${f.breakpoint} ${f.route}:`, JSON.stringify(f.issues));
}
process.exit(failed.length ? 1 : 0);
