import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * The Finance Close on paper — A4 landscape, every page, measured in a real Chromium.
 *
 * jsdom applies no `@media print`, lays nothing out and has no idea what a page is,
 * so every rule in index.css that the close depends on is invisible to the unit
 * suite. This prints the screen the way "Print → Save as PDF" does, with a period
 * of two hundred people, and asks what a reader of the paper would notice first:
 * does anything fall off the sheet, does a column name break mid-word, does every
 * page carry the header that says which close it is, does a row ever tear in two.
 *
 * Nothing here reaches the network: every Supabase request is answered below.
 */

const PROJECT_REF = "ybtrzqzliepknpzqdajx";

const FAKE_SESSION = {
  access_token: "fixture-access-token",
  refresh_token: "fixture-refresh-token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: 4_102_444_800,
  user: {
    id: "00000000-0000-4000-8000-0000000000ad",
    aud: "authenticated",
    role: "authenticated",
    email: "fixture-admin@fixture.local",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-01-01T00:00:00Z",
  },
};

/** A closed period, so the sheet is the one finance is actually handed. */
const PERIOD = { id: "p-aug", name: "Period 9", start_date: "2026-08-10", end_date: "2026-09-06" };

const FIRST = ["Maria", "João", "Ana", "Pedro", "Kleyve", "Fabio", "Felipe", "Elias", "Daniel", "Oksana",
  "Priya", "Tomasz", "Bogdan", "Chiara", "Mohammed"];
const LAST = ["Silva", "Pinelli", "Soares", "da Conceição Fernandes Albuquerque", "Kowalczyk",
  "Nascimento", "O'Sullivan-McAllister", "Wiśniewski", "Patel", "Rodrigues"];
const CREWS = ["Day", "Night", "Weekend", "Warehouse Day", "Warehouse Weekend"];
const DEPTS = ["Production", "Production", "Production", "Hygiene", "Warehouse", "Laboratory", "Office"];

const PEOPLE = 205;

function dates(from: string, to: string) {
  const out: string[] = [];
  for (let d = new Date(`${from}T12:00:00Z`); d <= new Date(`${to}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function fixture() {
  const employees = Array.from({ length: PEOPLE }, (_, i) => ({
    id: `e-${String(i).padStart(4, "0")}`,
    full_name: `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`,
    department: i % 23 === 0 ? null : DEPTS[i % DEPTS.length],
    shift_group: CREWS[i % CREWS.length],
    shift_pattern_id: i % 2 ? "sp-mt" : "sp-fm",
    shift_patterns: i % 2 ? { name: "Mon–Thu", days: [1, 2, 3, 4] } : { name: "Fri–Mon", days: [5, 6, 7, 1] },
  }));
  const days = dates(PERIOD.start_date, PERIOD.end_date);
  const attendance: Record<string, unknown>[] = [];
  const allocations: Record<string, unknown>[] = [];
  employees.forEach((e, i) => {
    days.forEach((d, j) => {
      if ((i + j) % 3 === 0) {
        attendance.push({
          employee_id: e.id, on_date: d, worked_minutes: 660,
          balance_minutes: ((i * 13 + j * 7) % 120) - 50,
          absence_name: (i + j) % 17 === 0 ? "Sick" : (i + j) % 19 === 0 ? "Holiday" : null,
        });
      }
      if ((i + j) % 2 === 0) {
        allocations.push({
          employee_id: e.id, on_date: d,
          status: (i + j) % 11 === 0 ? "holiday" : (i + j) % 13 === 0 ? "overtime" : "assigned",
          shift: e.shift_group === "Night" ? "Night" : "Day",
          left_early_at: (i + j) % 29 === 0 ? `${d}T14:00:00` : null,
          arrived_late_at: null,
        });
      }
    });
  });
  const opening = employees.map((e, i) => ({ employee_id: e.id, balance_minutes: (i * 37) % 900 - 450 }));
  const payroll = employees.filter((_, i) => i % 4 === 0).map((e, i) => ({ employee_id: e.id, hours: 3 + (i % 9) }));
  return { employees, attendance, allocations, opening, payroll };
}

async function stubSupabase(page: Page) {
  const f = fixture();
  await page.addInitScript(
    ([ref, session]) => {
      window.localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(session));
    },
    [PROJECT_REF, FAKE_SESSION] as const,
  );

  await page.route(/supabase\.co/, async (route: Route) => {
    const url = new URL(route.request().url());
    const json = (data: unknown) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
    const page_ = (rows: unknown[]) => {
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? rows.length);
      return json(rows.slice(offset, offset + limit));
    };
    const p = url.pathname;
    const q = url.search;

    if (p.includes("/auth/v1/user")) return json(FAKE_SESSION.user);
    if (p.includes("/auth/v1/token")) return json(FAKE_SESSION);
    if (p.includes("/rpc/get_user_role")) return json("admin");
    if (p.includes("/rpc/has_role") || p.includes("/rpc/is_owner")) return json(true);
    if (p.includes("/rpc/")) return json(null);
    if (p.endsWith("/profiles")) {
      return json([{ id: FAKE_SESSION.user.id, name: "Fixture Admin", email: FAKE_SESSION.user.email, active: true }]);
    }
    if (p.endsWith("/workforce_payroll_periods")) return json([PERIOD]);
    if (p.endsWith("/employees") && q.includes("shift_patterns")) return json(f.employees);
    if (p.endsWith("/attendance_days")) {
      // The opening balance is the read with `lt` and no upper bound.
      return q.includes("on_date=lt.") ? page_(f.opening) : page_(f.attendance);
    }
    if (p.endsWith("/overtime_entries") && q.includes("select=employee_id%2Chours")) return json(f.payroll);
    if (p.endsWith("/daily_allocations")) return page_(f.allocations);
    if (p.endsWith("/shift_patterns")) {
      return json([
        { id: "sp-mt", starts_at: "06:00", ends_at: "18:00", break_minutes: 60 },
        { id: "sp-fm", starts_at: "06:00", ends_at: "18:00", break_minutes: 60 },
      ]);
    }
    return json([]);
  });

  const erros: string[] = [];
  page.on("pageerror", (e) => erros.push(String(e)));
  return erros;
}

/** A4 landscape at 96 dpi, which is what the browser lays a printed page out at. */
const A4_LANDSCAPE = { width: 1123, height: 794 };

test("the Finance Close prints on A4 landscape without losing a column, a row or its title", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const erros = await stubSupabase(page);

  await page.goto("/dashboard/finance-close");
  await page.waitForSelector("table.close-register tbody tr", { timeout: 30_000 });
  expect(erros).toEqual([]);

  const onScreen = await page.locator("table.close-register tbody tr").count();
  expect(onScreen).toBe(PEOPLE);

  await page.emulateMedia({ media: "print" });
  await page.setViewportSize(A4_LANDSCAPE);
  await page.waitForTimeout(300);

  const m = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const reg = document.querySelector<HTMLTableElement>("table.close-register")!;
    const r = reg.getBoundingClientRect();
    // Any header or cell whose text is wider than its box — a clipped or broken figure.
    const overflowing: string[] = [];
    reg.querySelectorAll<HTMLElement>("th, td").forEach((c) => {
      if (c.scrollWidth > c.clientWidth + 1) overflowing.push((c.textContent ?? "").trim().slice(0, 30));
    });
    const visible = (sel: string) =>
      [...document.querySelectorAll<HTMLElement>(sel)].filter((el) => {
        const s = getComputedStyle(el);
        return s.display !== "none" && s.visibility !== "hidden" && el.getBoundingClientRect().height > 0;
      }).length;
    return {
      vw,
      tableLeft: r.left,
      tableRight: r.right,
      overflowing: overflowing.slice(0, 10),
      buttons: visible("button"),
      comboboxes: visible("[role=combobox]"),
      nav: visible("nav:not(.print-keep), aside:not(.print-keep)"),
      caption: visible("th.print-caption"),
      summary: visible("table.close-summary"),
      notes: visible(".close-notes"),
      // A table or card that may not break is moved whole to the next sheet: that
      // is how the register used to start on page two under a near-empty page one.
      registerBreak: getComputedStyle(reg).breakInside,
      cardBreak: getComputedStyle(reg.closest<HTMLElement>("[class*='rounded-']")!).breakInside,
      page: getComputedStyle(document.querySelector(".close-sheet")!).getPropertyValue("page"),
    };
  });

  expect(m.tableLeft, "register starts off the page").toBeGreaterThanOrEqual(0);
  expect(m.tableRight, "register runs off the right edge of the sheet").toBeLessThanOrEqual(m.vw + 1);
  expect(m.overflowing, "text wider than its cell").toEqual([]);
  expect(m.buttons, "buttons printed").toBe(0);
  expect(m.comboboxes, "dropdowns printed").toBe(0);
  expect(m.nav, "navigation printed").toBe(0);
  expect(m.caption, "the repeating title row is missing").toBe(1);
  expect(m.summary).toBe(1);
  expect(m.notes).toBe(1);
  expect(m.registerBreak).toBe("auto");
  expect(m.cardBreak).toBe("auto");
  // The named page is the one with margins and "Page n of N" in its margin boxes.
  expect(m.page).toBe("finance-close");

  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  // A4 landscape, from the CSS — 841.92 × 595.2 pt.
  expect(pdf.toString("latin1")).toMatch(/\/MediaBox \[0 0 841\.9\d* 59[45]\.\d+\]/);
  // Two hundred and five people fit in eleven sheets with the register starting
  // under the summary on page one. Twelve means a block was pushed whole to the
  // next page again.
  const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  expect(pages).toBeLessThanOrEqual(11);
  await test.info().attach("finance-close.pdf", { body: pdf, contentType: "application/pdf" });
  if (process.env.FC_PDF_OUT) {
    const fs = await import("node:fs");
    fs.writeFileSync(process.env.FC_PDF_OUT, pdf);
  }
});

test("filtered to Production · Weekend, the sheet prints that crew and no other", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await stubSupabase(page);
  await page.goto("/dashboard/finance-close");
  await page.waitForSelector("table.close-register tbody tr", { timeout: 30_000 });

  await page.getByRole("button", { name: "Departments" }).click();
  await page.getByRole("checkbox", { name: "Production" }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("combobox").filter({ hasText: "Every crew" }).click();
  await page.getByRole("option", { name: "Weekend", exact: true }).click();

  await page.emulateMedia({ media: "print" });
  await page.setViewportSize(A4_LANDSCAPE);

  const s = await page.evaluate(() => ({
    summary: [...document.querySelectorAll("table.close-summary tbody tr")]
      .map((tr) => tr.querySelector("td")?.textContent?.trim()),
    crews: [...new Set([...document.querySelectorAll("table.close-register tbody tr")]
      .map((tr) => tr.children[1]?.textContent?.trim()))],
    depts: [...new Set([...document.querySelectorAll("table.close-register tbody tr")]
      .map((tr) => tr.children[2]?.textContent?.trim()))],
    caption: document.querySelector("th.print-caption")?.textContent ?? "",
  }));
  // Only the total, named after the filter — no Day, Night or Warehouse lines.
  expect(s.summary).toEqual(["Production · Weekend"]);
  expect(s.crews).toEqual(["Weekend"]);
  expect(s.depts).toEqual(["Production"]);
  expect(s.caption).toContain("Production · Weekend only");
});

test("two departments ticked at once, the sheet holds both and nobody else", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await stubSupabase(page);
  await page.goto("/dashboard/finance-close");
  await page.waitForSelector("table.close-register tbody tr", { timeout: 30_000 });

  await page.getByRole("button", { name: "Departments" }).click();
  await page.getByRole("checkbox", { name: "Hygiene" }).click();
  await page.getByRole("checkbox", { name: "Laboratory" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Departments" })).toHaveText("Hygiene + Laboratory");

  const depts = await page.evaluate(() => [...new Set([...document.querySelectorAll("table.close-register tbody tr")]
    .map((tr) => tr.children[2]?.textContent?.trim()))].sort());
  expect(depts).toEqual(["Hygiene", "Laboratory"]);

  // "Every department" clears the ticks rather than being one more department.
  await page.getByRole("button", { name: "Departments" }).click();
  await page.getByRole("checkbox", { name: "Every department" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Departments" })).toHaveText("Every department");
});
