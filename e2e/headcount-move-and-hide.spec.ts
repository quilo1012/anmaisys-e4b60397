import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * Move a line's whole team, and hide a line on one shift (30/10/2026).
 *
 * Every request to Supabase is answered here; nothing reaches the real database. What is
 * asserted is what the board would SEND: one update over the movers' row ids, guarded on
 * the source line, and one row (line + shift) to hide a line.
 */
const REF = "ybtrzqzliepknpzqdajx";
const SESSION = {
  access_token: "t", refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: 4_102_444_800,
  user: { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "a@f.local", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
};
const AREAS = [
  ["l3", "Line 3"], ["l4", "Line 4"], ["l5", "Line 5"], ["l6", "Line 6"],
].map(([id, name], i) => ({ id, name, kind: "production", section: "production", sort_order: (i + 1) * 10, active: true, sheet_label: null, sheet_group: null, department: null }));

const EMP = ["Ana Lima", "Bruno Reis", "Carla Dias", "Davi Melo", "Eva Rocha", "Fabio Luz", "Gil Sa"].map((full_name, i) => ({
  id: `e${i}`, full_name, employee_ref: `E${i}`, department: null, position: null, active: true, shift_group: "Day", shift_pattern_id: null, sheet_aliases: null, left_on: null,
}));
const row = (n: number, employee_id: string, area_id: string | null, extra: Record<string, unknown> = {}) => ({
  id: `a${n}`, employee_id, on_date: "2026-10-01", shift: "Day", area_id, status: "assigned", half_day: false,
  left_early_at: null, arrived_late_at: null, note: null, is_leader: false, ...extra,
});
// Line 4: five people (one of them on overtime, one leading), plus a row for somebody no
// longer on the staff list. Line 5: one person. Line 6: one person.
const ALLOCS = [
  row(1, "e0", "l4", { is_leader: true }), row(2, "e1", "l4"), row(3, "e2", "l4", { status: "overtime" }), row(4, "e3", "l4"), row(5, "e4", "l4"),
  row(6, "gone", "l4"),
  row(7, "e5", "l5"), row(8, "e6", "l6"),
];

async function stub(page: Page, opts: { hidden?: unknown[]; allocs?: unknown[] } = {}) {
  await page.addInitScript(([ref, s]) => {
    window.localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(s));
    window.sessionStorage.setItem("pin-ok:workforce", "1");
  }, [REF, SESSION] as const);
  await page.route(/supabase\.co/, async (route: Route) => {
    const url = route.request().url();
    const method = route.request().method();
    const json = (d: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(d) });
    if (url.includes("/auth/v1/user")) return json(SESSION.user);
    if (url.includes("/auth/v1/token")) return json(SESSION);
    if (url.includes("/rpc/get_user_role")) return json("admin");
    if (url.includes("/rest/v1/headcount_area_hidden")) return method === "GET" ? json(opts.hidden ?? []) : json([]);
    if (url.includes("/rest/v1/headcount_areas")) return json(AREAS);
    if (url.includes("/rest/v1/daily_allocations")) {
      if (method === "PATCH") {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        if ("area_id" in body) return json(ALLOCS.filter((a) => a.area_id === "l4" && a.employee_id !== "gone").map((a) => ({ ...a, area_id: body.area_id })));
        return json([]);
      }
      return json(opts.allocs ?? ALLOCS);
    }
    if (url.includes("/rest/v1/employees")) return json(EMP);
    if (url.includes("/rest/v1/profiles")) return json({ id: SESSION.user.id, name: "Office", email: SESSION.user.email, active: true });
    return json([]);
  });
}

async function openDay(page: Page) {
  await page.setViewportSize({ width: 1400, height: 1100 });
  await page.goto("/dashboard/headcount");
  await page.getByRole("tab", { name: "Day" }).click();
  await expect(page.locator(".headcount-columns").getByText("Bruno Reis").first()).toBeVisible({ timeout: 20000 });
}

test("a whole team moves from Line 4 to Line 5 in one update, after saying who goes and who stays", async ({ page }) => {
  const patches: { url: string; body: Record<string, unknown> }[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/rest/v1/daily_allocations") && r.method() === "PATCH") patches.push({ url: decodeURIComponent(r.url()), body: r.postDataJSON() });
  });
  await stub(page);
  await openDay(page);

  await page.getByRole("button", { name: "Line 4 actions" }).click();
  await page.getByRole("menuitem", { name: /Move entire team \(5\)/ }).click();

  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByRole("list", { name: "People who will move" }).getByRole("listitem")).toHaveCount(5);
  // The row of somebody no longer on the staff list is named as staying, with the reason.
  await expect(dialog.getByRole("list", { name: "People who will stay" })).toContainText(/no longer active/i);

  // Nothing is written before a destination is chosen and confirmed.
  await expect(dialog.getByRole("button", { name: /^Move/ })).toBeDisabled();
  await dialog.getByRole("combobox", { name: "Destination line" }).click();
  await page.getByRole("option", { name: "Line 5" }).click();
  await expect(dialog).toContainText("Ana Lima keeps leading the team on Line 5");
  // The two totals first: Line 4 goes from 5 to 0, Line 5 from 1 to 6.
  const totals = dialog.getByRole("table", { name: "Headcount before and after" });
  await expect(totals.getByRole("row", { name: /Line 4/ })).toHaveText(/Line 4\s*5\s*0/);
  await expect(totals.getByRole("row", { name: /Line 5/ })).toHaveText(/Line 5\s*1\s*6/);
  expect(patches).toHaveLength(0);
  await dialog.getByRole("button", { name: "Move 5 to Line 5" }).click();

  await expect.poll(() => patches.length).toBeGreaterThanOrEqual(1);
  const move = patches[0];
  expect(move.body).toEqual({ area_id: "l5" });
  expect(move.url).toContain("id=in.(a1,a2,a3,a4,a5)");
  expect(move.url).toContain("area_id=eq.l4");
  expect(move.url).toMatch(/on_date=eq\.\d{4}-\d{2}-\d{2}/);
  expect(move.url).toContain("shift=eq.Day");
  // The leader's mark goes after them, on the destination only.
  await expect.poll(() => patches.find((p) => "is_leader" in p.body)?.url ?? "").toContain("id=eq.a1");
});

test("the leader mark stays behind when the destination already has a leader", async ({ page }) => {
  const allocs = ALLOCS.map((a) => (a.id === "a7" ? { ...a, is_leader: true } : a));
  await stub(page, { allocs });
  await openDay(page);
  await page.getByRole("button", { name: "Line 4 actions" }).click();
  await page.getByRole("menuitem", { name: /Move entire team/ }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("combobox", { name: "Destination line" }).click();
  await page.getByRole("option", { name: "Line 5" }).click();
  await expect(dialog).toContainText("Line 5 is already led by Fabio Luz");
});

test("hiding a line on Day sends that line and that shift, and nothing about people", async ({ page }) => {
  const writes: Record<string, unknown>[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/rest/v1/headcount_area_hidden") && r.method() === "POST") writes.push(r.postDataJSON());
    if (r.url().includes("/rest/v1/daily_allocations") && r.method() !== "GET") writes.push({ touchedAllocations: true });
  });
  await stub(page);
  await openDay(page);
  await page.getByRole("button", { name: "Line 6 actions" }).click();
  await page.getByRole("menuitem", { name: "Hide on day shift" }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toEqual({ area_id: "l6", shift: "Day" });
});

test("a line hidden on Day leaves the board, a Night setting does not touch Day, and a staffed hidden line stays drawn", async ({ page }) => {
  // Line 3 is empty and hidden on Day; Line 6 is hidden on Night only; Line 5 is hidden on
  // Day but has somebody on it.
  await stub(page, {
    hidden: [{ area_id: "l3", shift: "Day" }, { area_id: "l6", shift: "Night" }, { area_id: "l5", shift: "Day" }],
  });
  await openDay(page);
  const titles = page.locator(".headcount-columns .headcount-column-title");
  await expect(titles).toContainText(["Line 4", "Line 5", "Line 6"]);
  await expect(titles.filter({ hasText: "Line 3" })).toHaveCount(0);
  await expect(page.locator(".headcount-sheet-column", { hasText: "Line 5" })).toContainText("Hidden on this shift");

  // The way back: the list of lines hidden on this shift, each with Show.
  await page.getByRole("button", { name: "Hidden lines (2)" }).click();
  const list = page.getByRole("list", { name: "Lines hidden on the Day shift" });
  await expect(list).toContainText("Line 3");
  await expect(list).not.toContainText("Line 6");
  const deletes: string[] = [];
  page.on("request", (r) => { if (r.url().includes("/rest/v1/headcount_area_hidden") && r.method() === "DELETE") deletes.push(decodeURIComponent(r.url())); });
  await list.getByRole("listitem").filter({ hasText: "Line 3" }).getByRole("button", { name: "Show" }).click();
  await expect.poll(() => deletes.length).toBe(1);
  expect(deletes[0]).toContain("area_id=eq.l3");
  expect(deletes[0]).toContain("shift=eq.Day");
});

test("without BLOCO 140 the board draws every line and the hide switch says why it is off", async ({ page }) => {
  await stub(page);
  await page.route(/headcount_area_hidden/, (route) =>
    route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ code: "PGRST205", message: "Could not find the table" }) }));
  await openDay(page);
  await expect(page.locator(".headcount-columns .headcount-column-title")).toHaveCount(4);
  await page.getByRole("button", { name: "Line 6 actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Hide line (not available yet)" })).toHaveAttribute("aria-disabled", "true");
});

test("a team move can be undone from the message that confirms it", async ({ page }) => {
  const patches: { url: string; body: Record<string, unknown> }[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/rest/v1/daily_allocations") && r.method() === "PATCH") patches.push({ url: decodeURIComponent(r.url()), body: r.postDataJSON() });
  });
  await stub(page);
  await openDay(page);
  await page.getByRole("button", { name: "Line 4 actions" }).click();
  await page.getByRole("menuitem", { name: /Move entire team/ }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("combobox", { name: "Destination line" }).click();
  await page.getByRole("option", { name: "Line 5" }).click();
  await dialog.getByRole("button", { name: "Move 5 to Line 5" }).click();

  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => patches.filter((p) => "area_id" in p.body).length).toBe(2);
  const back = patches.filter((p) => "area_id" in p.body)[1];
  expect(back.body).toEqual({ area_id: "l4" });
  expect(back.url).toContain("id=in.(a1,a2,a3,a4,a5)");
  // Guarded on the destination: anybody moved again by hand since is left alone.
  expect(back.url).toContain("area_id=eq.l5");
  // And the leader mark goes back to the line it came from.
  await expect.poll(() => patches.filter((p) => "is_leader" in p.body).length).toBe(2);
});

test("a hidden line leaves Excel's double rule where it was, and a tap brings it back", async ({ page }) => {
  await stub(page, { hidden: [{ area_id: "l3", shift: "Day" }] });
  await openDay(page);
  await expect(page.locator(".headcount-columns .headcount-column-title").filter({ hasText: "Line 3" })).toHaveCount(0);
  const deletes: string[] = [];
  page.on("request", (r) => { if (r.url().includes("/rest/v1/headcount_area_hidden") && r.method() === "DELETE") deletes.push(decodeURIComponent(r.url())); });
  await page.getByRole("button", { name: "Show Line 3 hidden on the day shift" }).click();
  await expect.poll(() => deletes.length).toBe(1);
  expect(deletes[0]).toContain("area_id=eq.l3");
});
