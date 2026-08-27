#!/usr/bin/env python3
"""E2E mobile/responsive audit — measurement only, never fixes anything.

For every dashboard route x breakpoint it records:
  1. horizontal document overflow + the 5 guilty elements
  2. touch targets smaller than 40x40
  3. text rendered below 12px
  4. <table> wider than the viewport with no overflow-x ancestor
  5. content hidden under the fixed mobile bottom bar
  6. the same 1-3 checks with the first "New/Add/Create" dialog open

Usage (dev server on :8080, sandbox with Playwright + Supabase session):
  python3 scripts/e2e/responsive.py

Always exits 0 — this phase wants the whole report, not an early stop.
Outputs: /tmp/browser/responsive/{report.json,report.md,*.png}
"""
import asyncio, json, os, sys
from collections import Counter
from pathlib import Path
from playwright.async_api import async_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:8080")
OUT = Path(os.environ.get("OUT_DIR", "/tmp/browser/responsive"))
OUT.mkdir(parents=True, exist_ok=True)

BREAKPOINTS = [
    ("mobile-small", 360, 740),
    ("mobile", 390, 844),
    ("mobile-large", 430, 932),
    ("tablet", 768, 1024),
    ("desktop", 1280, 900),
]

# Read from src/App.tsx. Login/signup/reset/consent and pure redirects excluded.
# /dashboard/executive and /dashboard/production-planner do not exist in App.tsx.
ROUTES = [
    "/dashboard/operator",
    "/dashboard/operator/my-production",
    "/dashboard/operator/performance",
    "/dashboard/engineer",
    "/dashboard/manager",
    "/dashboard/analytics",
    "/dashboard/reports",
    "/dashboard/work-orders",
    "/dashboard/machines",
    "/dashboard/problems",
    "/dashboard/control-center",
    "/dashboard/people",
    "/dashboard/leave",
    "/dashboard/attendance",
    "/dashboard/finance-close",
    "/dashboard/headcount",
    "/dashboard/audit-logs",
    "/dashboard/downtime",
    "/dashboard/downtime-map",
    "/dashboard/preventive",
    "/dashboard/pm-intelligence",
    "/dashboard/reliability",
    "/dashboard/stock",
    "/dashboard/users",
    "/dashboard/permissions",
    "/dashboard/settings",
    "/dashboard/suppliers",
    "/dashboard/sku-products",
    "/dashboard/production-performance",
    "/dashboard/quality",
    "/dashboard/quality-report",
    "/dashboard/shift-history",
    "/dashboard/rag-weekly",
    "/dashboard/leader-scorecard",
    "/dashboard/leader/scorecard",
    "/dashboard/line-production",
    "/dashboard/line-display",
    "/dashboard/messages",
    "/dashboard/system",
    "/dashboard/warehouse",
    "/dashboard/operator-chat-settings",
    "/dashboard/shift-password-settings",
    "/dashboard/root-diagnostics",
    "/dashboard/intouch-settings",
    "/dashboard/intouch-machines",
    "/dashboard/intouch-stop-codes",
]

# ---------------------------------------------------------------- browser JS

JS_AUDIT = """
(vw) => {
  const out = { overflow: null, wide: [], smallTargets: [], smallTargetCount: 0,
                tinyText: [], tinyTextCount: 0, tables: [] };
  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth + 1)
    out.overflow = { sw: de.scrollWidth, cw: de.clientWidth };

  const scroller = (el) => {
    for (let n = el.parentElement; n; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (['auto','scroll'].includes(s.overflowX)) return n;
    }
    return null;
  };
  const desc = (el) => ({
    tag: el.tagName.toLowerCase(),
    cls: (typeof el.className === 'string' ? el.className : '').slice(0, 120),
    text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40),
  });
  const visible = (el, r) => {
    if (r.width === 0 && r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
  };

  // 1. who overflows
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (!visible(el, r)) continue;
    if (r.right > vw + 1 && !scroller(el)) out.wide.push({ ...desc(el), right: Math.round(r.right) });
  }
  out.wide.sort((a, b) => b.right - a.right);
  out.wide = out.wide.slice(0, 5);

  // 2. touch targets
  const tsel = 'button, a[href], [role=button], input[type=checkbox], input[type=radio]';
  const smalls = [];
  for (const el of document.querySelectorAll(tsel)) {
    const r = el.getBoundingClientRect();
    if (!visible(el, r)) continue;
    if (el.closest('td, th') && scroller(el)) continue;
    if (r.height < 40 || r.width < 40)
      smalls.push({ ...desc(el),
        label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40),
        w: Math.round(r.width), h: Math.round(r.height) });
  }
  out.smallTargetCount = smalls.length;
  smalls.sort((a, b) => (a.w * a.h) - (b.w * b.h));
  out.smallTargets = smalls.slice(0, 8);

  // 3. tiny text
  const tinies = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  let node;
  while ((node = walker.nextNode())) {
    const t = (node.textContent || '').trim();
    if (!t) continue;
    const el = node.parentElement;
    if (!el || seen.has(el)) continue;
    seen.add(el);
    const r = el.getBoundingClientRect();
    if (!visible(el, r)) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 12) tinies.push({ ...desc(el), fontSize: Math.round(fs * 10) / 10 });
  }
  out.tinyTextCount = tinies.length;
  tinies.sort((a, b) => a.fontSize - b.fontSize);
  out.tinyText = tinies.slice(0, 5);

  // 4. tables with no escape
  for (const t of document.querySelectorAll('table')) {
    const r = t.getBoundingClientRect();
    if (!visible(t, r)) continue;
    if (r.width > vw + 1 && !scroller(t))
      out.tables.push({ width: Math.round(r.width), cls: (typeof t.className === 'string' ? t.className : '').slice(0, 80),
                        parentCls: (t.parentElement && typeof t.parentElement.className === 'string' ? t.parentElement.className : '').slice(0, 120) });
  }
  return out;
}
"""

JS_BOTTOMBAR = """
() => {
  let bar = null;
  for (const n of document.querySelectorAll('nav, footer, div')) {
    const s = getComputedStyle(n);
    if (s.position !== 'fixed') continue;
    const r = n.getBoundingClientRect();
    if (r.height === 0 || r.width < window.innerWidth * 0.7) continue;
    if (Math.abs(r.bottom - window.innerHeight) > 4) continue;
    if (!bar || r.height > bar.h) bar = { h: Math.round(r.height), tag: n.tagName.toLowerCase(),
      cls: (typeof n.className === 'string' ? n.className : '').slice(0, 80) };
  }
  if (!bar) return { bar: null };
  const main = document.querySelector('main') || document.querySelector('[role=main]');
  if (!main) return { bar, overlap: null };
  const mr = main.getBoundingClientRect();
  const limit = window.innerHeight - bar.h;
  const contentBottom = Math.round(mr.top + main.scrollHeight);
  return { bar, overlap: contentBottom > limit + 1 ? { contentBottom, limit: Math.round(limit) } : null };
}
"""

DIALOG_WORDS = ["new", "add", "create", "novo", "adicionar"]


def summarise(a, prefix=""):
    issues = []
    if a["overflow"]:
        issues.append({"type": prefix + "horizontal-overflow", "detail": a["overflow"], "culprits": a["wide"]})
    if a["smallTargetCount"]:
        issues.append({"type": prefix + "small-touch-targets", "count": a["smallTargetCount"], "worst": a["smallTargets"]})
    if a["tinyTextCount"]:
        issues.append({"type": prefix + "tiny-text", "count": a["tinyTextCount"], "worst": a["tinyText"]})
    if a.get("tables"):
        issues.append({"type": prefix + "table-no-scroller", "count": len(a["tables"]), "tables": a["tables"]})
    return issues


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


async def open_dialog(page):
    """Click the first obvious create button. Returns 'opened' | 'no-dialog'."""
    for word in DIALOG_WORDS:
        btns = page.locator("button", has_text=__import__("re").compile(word, 2))
        n = await btns.count()
        for i in range(min(n, 3)):
            b = btns.nth(i)
            try:
                if not await b.is_visible():
                    continue
                await b.click(timeout=2000)
                await page.wait_for_timeout(500)
                if await page.locator("[role=dialog]").count():
                    return "opened"
                await page.keyboard.press("Escape")
            except Exception:
                continue
    return "no-dialog"


async def main():
    if not os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON"):
        print("!! no Supabase session in env — the report would be 40 login screens. Aborting.")
        return
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
                        await page.goto(f"{BASE}{route}", wait_until="networkidle", timeout=25000)
                        await page.wait_for_timeout(500)
                        entry["url"] = page.url
                        if "/login" in page.url:
                            entry["issues"].append({"type": "not-authenticated"})
                        else:
                            audit = await page.evaluate(JS_AUDIT, w)
                            entry["issues"] += summarise(audit)
                            bb = await page.evaluate(JS_BOTTOMBAR)
                            entry["bottomBar"] = bb.get("bar")
                            if bb.get("overlap"):
                                entry["issues"].append({"type": "content-under-bottom-bar", "detail": bb["overlap"], "bar": bb["bar"]})
                            state = await open_dialog(page)
                            entry["dialog"] = state
                            if state == "opened":
                                da = await page.evaluate(JS_AUDIT, w)
                                entry["issues"] += summarise(da, prefix="dialog-")
                                await page.keyboard.press("Escape")
                                await page.wait_for_timeout(200)
                    except Exception as e:
                        entry["issues"].append({"type": "nav-error", "detail": str(e)[:200]})
                    if entry["issues"]:
                        shot = OUT / f"{name}_{route.strip('/').replace('/', '_') or 'root'}.png"
                        try:
                            await page.screenshot(path=str(shot), full_page=True)
                            entry["screenshot"] = str(shot)
                        except Exception:
                            pass
                    results.append(entry)
                    print(f"[{name}] {route} — {'FAIL ' + str(len(entry['issues'])) if entry['issues'] else 'ok'}")
                await context.close()
        finally:
            await browser.close()

    (OUT / "report.json").write_text(json.dumps(results, indent=2))

    lines = ["# Mobile responsive audit", "", "| route | breakpoint | issues | types |", "|---|---|---|---|"]
    for r in results:
        if not r["issues"]:
            continue
        types = ", ".join(sorted({i["type"] for i in r["issues"]}))
        lines.append(f"| {r['route']} | {r['breakpoint']} | {len(r['issues'])} | {types} |")

    per_route = Counter()
    types_route = {}
    for r in results:
        per_route[r["route"]] += len(r["issues"])
        types_route.setdefault(r["route"], set()).update(i["type"] for i in r["issues"])
    lines += ["", "## Worst routes (all breakpoints)", "", "| route | issues | types |", "|---|---|---|"]
    for route, count in per_route.most_common():
        if count:
            lines.append(f"| {route} | {count} | {', '.join(sorted(types_route[route]))} |")
    (OUT / "report.md").write_text("\n".join(lines))

    print("\n== worst routes ==")
    for route, count in per_route.most_common(20):
        print(f"  {count:3d}  {route}  [{', '.join(sorted(types_route[route]))}]")
    print(f"\nreport: {OUT/'report.json'} / {OUT/'report.md'}")

asyncio.run(main())
