import { test, expect } from "@playwright/test";

for (const width of [320, 375, 390, 430]) {
  test(`login fits a ${width}px phone`, async ({ page }) => {
    await page.setViewportSize({ width, height: 780 });
    await page.route(/supabase\.co/, (r) => {
      const u = r.request().url();
      const body = u.includes("list_tablet_accounts_public")
        ? [{ id: "t1", label: "Line 3", line_ids: [], line_names: ["Line 3"], favicon_url: null }]
        : null;
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible({ timeout: 20000 });
    const m = await page.evaluate(() => {
      const box = (s: string) => document.querySelector(s)!.getBoundingClientRect();
      const fs = (s: string) => parseFloat(getComputedStyle(document.querySelector(s)!).fontSize);
      const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Sign in")!;
      return {
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        idH: box("#identifier").height, pwH: box("#password").height,
        btnH: btn.getBoundingClientRect().height,
        idFs: fs("#identifier"), pwFs: fs("#password"),
      };
    });
    expect(m.overflow).toBeLessThanOrEqual(0);
    expect(m.idH).toBeGreaterThanOrEqual(44);
    expect(m.pwH).toBeGreaterThanOrEqual(44);
    expect(m.btnH).toBeGreaterThanOrEqual(44);
    expect(m.idFs).toBeGreaterThanOrEqual(16);
    expect(m.pwFs).toBeGreaterThanOrEqual(16);
  });
}
