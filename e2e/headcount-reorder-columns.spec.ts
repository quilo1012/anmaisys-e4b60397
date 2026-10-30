import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * Dragging a whole column of the Headcount board to another place (30/10/2026).
 *
 * Every request to Supabase is answered here; nothing reaches the real database. The
 * stub keeps the lines' sort_order in memory and applies the PATCHes it is sent, so a
 * reload reads back what the board saved — the same round trip the real table makes.
 */
const REF = "ybtrzqzliepknpzqdajx";
const SESSION = {
  access_token: "t", refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: 4_102_444_800,
  user: { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "a@f.local", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
};
const LINES = ["Line 1", "Line 2", "Line 3", "Line 4", "Line 5", "Line 6"];
const EMP = ["Ana Lima", "Bruno Reis", "Carla Dias", "Davi Melo", "Eva Rocha", "Fabio Luz", "Gil Sa", "Hugo Paz"].map((full_name, i) => ({
  id: `e${i}`, full_name, employee_ref: `E${i}`, department: null, position: null, active: true, shift_group: "Day", shift_pattern_id: null, sheet_aliases: null, left_on: null,
}));
// Line 1: three people. Line 2: two. Line 3: one. Line 6: two. 4 and 5 empty.
const PLACES: [string, string][] = [["e0", "l1"], ["e1", "l1"], ["e2", "l1"], ["e3", "l2"], ["e4", "l2"], ["e5", "l3"], ["e6", "l6"], ["e7", "l6"]];
const ALLOCS = PLACES.map(([employee_id, area_id], n) => ({
  id: `a${n}`, employee_id, on_date: "2026-10-01", shift: "Day", area_id, status: "assigned", half_day: false,
  left_early_at: null, arrived_late_at: null, note: null, is_leader: false,
}));

type Area = { id: string; name: string; sort_order: number };

async function stub(page: Page, db: { areas: Area[]; patches: { id: string; sort_order: number }[]; allocWrites: number }) {
  await page.addInitScript(([ref, s]) => {
    window.localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(s));
    window.sessionStorage.setItem("pin-ok:workforce", "1");
  }, [REF, SESSION] as const);
  await page.route(/supabase\.co/, async (route: Route) => {
    const req = route.request();
    const url = decodeURIComponent(req.url());
    const json = (d: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(d) });
    if (url.includes("/auth/v1/user")) return json(SESSION.user);
    if (url.includes("/auth/v1/token")) return json(SESSION);
    if (url.includes("/rpc/get_user_role")) return json("admin");
    if (url.includes("/rest/v1/headcount_area_hidden")) return json([]);
    if (url.includes("/rest/v1/headcount_areas")) {
      if (req.method() === "PATCH") {
        const id = /id=eq\.([^&]+)/.exec(url)![1];
        const { sort_order } = req.postDataJSON() as { sort_order: number };
        db.patches.push({ id, sort_order });
        db.areas.find((a) => a.id === id)!.sort_order = sort_order;
        return json([{ id }]);
      }
      return json(db.areas.map((a) => ({ ...a, kind: "production", section: "production", active: true, sheet_label: null, sheet_group: null, department: null })));
    }
    if (url.includes("/rest/v1/daily_allocations")) {
      if (req.method() !== "GET") db.allocWrites++;
      return json(ALLOCS);
    }
    if (url.includes("/rest/v1/employees")) return json(EMP);
    if (url.includes("/rest/v1/profiles")) return json({ id: SESSION.user.id, name: "Office", email: SESSION.user.email, active: true });
    return json([]);
  });
}

function freshDb() {
  return { areas: LINES.map((name, i) => ({ id: `l${i + 1}`, name, sort_order: (i + 1) * 10 })), patches: [] as { id: string; sort_order: number }[], allocWrites: 0 };
}

async function openDay(page: Page) {
  await page.setViewportSize({ width: 1400, height: 1100 });
  await page.goto("/dashboard/headcount");
  await page.getByRole("tab", { name: "Day" }).click();
  await expect(page.locator(".headcount-columns").getByText("Bruno Reis").first()).toBeVisible({ timeout: 20000 });
}

const titles = (page: Page) => page.locator(".headcount-columns .headcount-column-title");
const column = (page: Page, name: string) => page.locator(".headcount-sheet-column").filter({ has: page.locator(".headcount-column-title", { hasText: new RegExp(`^${name}$`) }) });

/** Pick a column up by its grip and put it down over another, the way a mouse does. */
async function drag(page: Page, from: string, onto: string) {
  const grip = page.getByRole("button", { name: `Move ${from} to another position` });
  const g = (await grip.boundingBox())!;
  const t = (await column(page, onto).boundingBox())!;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2 + 10, g.y + g.height / 2, { steps: 3 });
  await page.mouse.move(t.x + t.width / 2, t.y + 60, { steps: 12 });
  await page.mouse.up();
}

test("Line 2 dropped on Line 3 swaps the two, writes two sort orders and nothing about people", async ({ page }) => {
  const db = freshDb();
  await stub(page, db);
  await openDay(page);
  await drag(page, "Line 2", "Line 3");

  await expect(titles(page)).toHaveText(["Line 1", "Line 3", "Line 2", "Line 4", "Line 5", "Line 6"]);
  await expect.poll(() => db.patches.length).toBe(2);
  expect(db.patches).toEqual(expect.arrayContaining([{ id: "l3", sort_order: 20 }, { id: "l2", sort_order: 30 }]));
  expect(db.allocWrites).toBe(0);
  // The team went with the column.
  await expect(column(page, "Line 2")).toContainText("Davi Melo");
  await expect(column(page, "Line 2")).toContainText("Eva Rocha");
});

test("Line 1 dropped on Line 6 takes its whole team, every total follows, and a reload keeps it", async ({ page }) => {
  const db = freshDb();
  await stub(page, db);
  await openDay(page);
  await drag(page, "Line 1", "Line 6");

  const order = ["Line 2", "Line 3", "Line 4", "Line 5", "Line 6", "Line 1"];
  await expect(titles(page)).toHaveText(order);
  await expect(page.getByText(/Line 1 moved to column 6 of 6/)).toBeVisible();
  const line1 = column(page, "Line 1");
  for (const n of ["Ana Lima", "Bruno Reis", "Carla Dias"]) await expect(line1).toContainText(n);
  await expect(line1.getByText("Total").locator("..")).toContainText("3");
  await expect(column(page, "Line 6").getByText("Total").locator("..")).toContainText("2");
  // Nobody doubled, nobody lost: eight names, each once.
  for (const e of EMP) await expect(page.locator(".headcount-columns").getByText(e.full_name, { exact: true })).toHaveCount(1);
  expect(db.allocWrites).toBe(0);

  await expect.poll(() => db.patches.length).toBe(6);
  await page.reload();
  await expect(page.locator(".headcount-columns").getByText("Bruno Reis").first()).toBeVisible({ timeout: 20000 });
  await expect(titles(page)).toHaveText(order);
});

test("the message that confirms a move can put the old order back", async ({ page }) => {
  const db = freshDb();
  await stub(page, db);
  await openDay(page);
  await drag(page, "Line 5", "Line 1");
  await expect(titles(page)).toHaveText(["Line 5", "Line 1", "Line 2", "Line 3", "Line 4", "Line 6"]);
  await expect.poll(() => db.patches.length).toBe(5);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(titles(page)).toHaveText(LINES);
  await expect.poll(() => db.areas.map((a) => a.sort_order)).toEqual([10, 20, 30, 40, 50, 60]);
});

test("a save the database refuses puts the columns back where they were", async ({ page }) => {
  const db = freshDb();
  await stub(page, db);
  await page.route(/headcount_areas\?.*id=eq/, (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({ status: 200, contentType: "application/json", body: "[]" })
      : route.fallback());
  await openDay(page);
  await drag(page, "Line 2", "Line 3");
  await expect(page.getByText(/your role may not change the board's columns/)).toBeVisible();
  await expect(titles(page)).toHaveText(LINES);
});
