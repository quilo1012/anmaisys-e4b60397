#!/usr/bin/env python3
"""E2E responsive smoke test.

Loads the app at 3 breakpoints (mobile / tablet / desktop) for a list of
dashboard routes and asserts:
  1. No horizontal page overflow (document.scrollWidth <= viewport width + 1).
  2. Every visible interactive control (button, a, input, select, [role=button])
     stays inside the viewport width.

Usage (dev server on :8080, sandbox with Playwright + Supabase session):
  python3 scripts/e2e/responsive.py

Exits non-zero if any check fails. Report + screenshots under /tmp/browser/responsive/.
"""
import asyncio, json, os, sys
from pathlib import Path
from playwright.async_api import async_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:8080")
OUT = Path(os.environ.get("OUT_DIR", "/tmp/browser/responsive"))
OUT.mkdir(parents=True, exist_ok=True)

BREAKPOINTS = [
    ("mobile", 375, 812),
    ("tablet", 768, 1024),
    ("desktop", 1280, 900),
]

ROUTES = [
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
]

async def restore_session(context, page):
    storage_key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    session_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    cookies_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_COOKIES_JSON")
    if cookies_json:
        cookies = json.loads(cookies_json)
        for c in cookies:
            c["url"] = BASE
        await context.add_cookies(cookies)
    await page.goto(BASE, wait_until="domcontentloaded")
    if storage_key and session_json:
        await page.evaluate(
            f"window.localStorage.setItem({json.dumps(storage_key)}, {json.dumps(session_json)})"
        )

async def audit_page(page, vw):
    overflow = await page.evaluate(
        "() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })"
    )
    issues = []
    if overflow["sw"] > overflow["cw"] + 1:
        issues.append(f"horizontal-overflow sw={overflow['sw']} cw={overflow['cw']}")
    bad = await page.evaluate(
        """(vw) => {
            const sel = 'button, a[href], input, select, textarea, [role=button]';
            const insideScroller = (el) => {
                for (let n = el.parentElement; n; n = n.parentElement) {
                    const s = getComputedStyle(n);
                    if (['auto','scroll'].includes(s.overflowX)) return true;
                    if (n.hasAttribute('data-radix-portal') || n.getAttribute('role') === 'dialog') return true;
                }
                return false;
            };
            const out = [];
            for (const el of document.querySelectorAll(sel)) {
                const r = el.getBoundingClientRect();
                if (r.width === 0 && r.height === 0) continue;
                if (r.right > vw + 1 && !insideScroller(el)) {
                    out.push({ tag: el.tagName.toLowerCase(),
                        label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40),
                        right: Math.round(r.right) });
                }
            }
            return out.slice(0, 6);
        }""",
        vw,
    )
    if bad:
        issues.append({"overflowing_controls": bad})
    return issues

async def main():
    results = []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        try:
            for name, w, h in BREAKPOINTS:
                context = await browser.new_context(viewport={"width": w, "height": h})
                page = await context.new_page()
                await restore_session(context, page)
                for route in ROUTES:
                    entry = {"breakpoint": name, "route": route, "issues": []}
                    try:
                        await page.goto(f"{BASE}{route}", wait_until="networkidle", timeout=20000)
                        await page.wait_for_timeout(400)
                        entry["issues"] = await audit_page(page, w)
                        if entry["issues"]:
                            shot = OUT / f"{name}_{route.strip('/').replace('/', '_') or 'root'}.png"
                            await page.screenshot(path=str(shot))
                            entry["screenshot"] = str(shot)
                    except Exception as e:
                        entry["issues"].append(f"nav-error: {e}")
                    results.append(entry)
                    status = "FAIL" if entry["issues"] else "ok"
                    print(f"[{name}] {route} — {status}")
                await context.close()
        finally:
            await browser.close()

    (OUT / "report.json").write_text(json.dumps(results, indent=2))
    failed = [r for r in results if r["issues"]]
    print(f"\n== {len(failed)}/{len(results)} checks failed ==")
    for f in failed:
        print(f"  {f['breakpoint']} {f['route']}: {json.dumps(f['issues'])[:200]}")
    sys.exit(1 if failed else 0)

asyncio.run(main())
