import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * Weekly RAG on a phone: one day at a time.
 *
 * Twenty-one columns on a 360px screen were a strip to scroll sideways, line by line,
 * without ever seeing a whole day. Below `md` the grid draws one day (Day / Night /
 * Total) or the week total, chosen from a sticky day bar. From `md` up the week grid
 * is untouched. Everything here is measured in a real browser; nothing reaches the
 * network — every Supabase call is answered from the fixture below.
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

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function mondayOf(d: Date): Date {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
}

/** Fixed clock: Wednesday 21 Oct 2026, 10:00 — a day shift, mid-week. */
const NOW = new Date(2026, 9, 21, 10, 0, 0);
const MONDAY = mondayOf(NOW);

type Write = { method: string; url: string; body: string | null };

async function stub(page: Page, opts: { slowComments?: boolean } = {}) {
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(
    ([ref, session]) => {
      window.localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(session));
    },
    [PROJECT_REF, FAKE_SESSION] as const,
  );
  const writes: Write[] = [];
  const mon = iso(MONDAY);
  const tue = iso(new Date(MONDAY.getFullYear(), MONDAY.getMonth(), MONDAY.getDate() + 1));
  const entries = [
    { id: "e1", entry_date: mon, line: "Line 1", shift: "DAY", plan_qty: 1000, actual_qty: 950, upm_target: 0, upm_actual: 12.5, downtime_min: 0, notes: null },
    { id: "e2", entry_date: mon, line: "Line 1", shift: "NIGHT", plan_qty: 800, actual_qty: 820, upm_target: 0, upm_actual: 11, downtime_min: 0, notes: null },
    { id: "e3", entry_date: tue, line: "Line 2", shift: "DAY", plan_qty: 500, actual_qty: 300, upm_target: 0, upm_actual: 9, downtime_min: 0, notes: null },
  ];

  await page.route(/supabase\.co/, async (route: Route) => {
    const req = route.request();
    const url = req.url();
    const json = (data: unknown) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
    if (req.method() !== "GET" && url.includes("/rest/v1/rag_weekly_entries")) {
      writes.push({ method: req.method(), url, body: req.postData() });
      return json([]);
    }
    if (opts.slowComments && url.includes("/rest/v1/rag_weekly_comments")) {
      await new Promise((r) => setTimeout(r, 1500));
      return json([]);
    }
    if (url.includes("/auth/v1/user")) return json(FAKE_SESSION.user);
    if (url.includes("/auth/v1/token")) return json(FAKE_SESSION);
    if (url.includes("/rpc/get_user_role")) return json("admin");
    if (url.includes("/rpc/has_role") || url.includes("/rpc/is_owner")) return json(true);
    if (url.includes("/rpc/") && /single|maybe/.test(url)) return json(null);
    if (url.includes("/profiles")) {
      return json([{ id: FAKE_SESSION.user.id, name: "Fixture Admin", email: FAKE_SESSION.user.email, active: true }]);
    }
    if (url.includes("/rest/v1/lines")) {
      return json([{ id: "l1", name: "Line 1", active: true }, { id: "l2", name: "Line 2", active: true }]);
    }
    if (url.includes("/rest/v1/rag_weekly_entries")) {
      return json(url.includes(`entry_date=gte.${mon}`) ? entries : []);
    }
    return json([]);
  });
  return writes;
}

const dayBar = (page: Page) => page.getByRole("tablist", { name: "Day of the week" });

async function open(page: Page, width: number) {
  await page.setViewportSize({ width, height: 800 });
  await page.goto("/dashboard/rag-weekly");
  await expect(page.getByRole("heading", { name: "Weekly RAG" })).toBeVisible();
}

test.describe("Weekly RAG on a phone", () => {
  test("opens on today, one day per grid, and fits 320px", async ({ page }) => {
    await stub(page);
    await open(page, 320);
    await expect(dayBar(page)).toBeVisible();
    await expect(dayBar(page).getByRole("tab", { selected: true })).toHaveAccessibleName(/Wednesday 21 Oct/);

    // Three columns per grid: Day, Night, Total — no other day, no week total.
    const grid = page.locator("#rag-line-Line-1 table");
    await expect(grid.locator("thead tr").first().locator("th")).toHaveCount(2);
    await expect(grid.getByText("Week total")).toHaveCount(0);

    const fits = await page.evaluate(() => {
      const doc = document.scrollingElement!;
      const grids = [...document.querySelectorAll<HTMLElement>("[data-rag-scroll]")];
      return {
        page: doc.scrollWidth <= window.innerWidth,
        grids: grids.every((g) => g.scrollWidth <= g.clientWidth + 1),
      };
    });
    expect(fits).toEqual({ page: true, grids: true });

    // index.css hides horizontal overflow on the page, so a control pushed past the
    // edge does not scroll — it is cut. Every control must end inside the screen.
    const cut = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("main button, main [role=combobox]")]
        .filter((el) => el.offsetParent !== null)
        .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 0.5)
        .map((el) => el.textContent?.trim() || el.getAttribute("aria-label") || el.tagName),
    );
    expect(cut).toEqual([]);

    for (const name of ["Previous day", "Next day"]) {
      const box = await page.getByRole("button", { name, exact: true }).boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }
  });

  test("the day bar marks the days that have data and the arrows cross weeks", async ({ page }) => {
    await stub(page);
    await open(page, 375);
    const bar = dayBar(page);
    await expect(bar.getByRole("tab", { name: /^Monday .*has RAG data/ })).toBeVisible();
    await expect(bar.getByRole("tab", { name: /^Tuesday .*has RAG data/ })).toBeVisible();
    await expect(bar.getByRole("tab", { name: /^Thursday/ })).not.toHaveAccessibleName(/has RAG data/);

    await bar.getByRole("tab", { name: /^Monday/ }).click();
    // Monday's figures: plan 1,000 day, 800 night, 1,800 total for Line 1.
    const line1 = page.locator("#rag-line-Line-1");
    await expect(line1.getByRole("row", { name: /^Plan/ })).toContainText("1,800");

    await page.getByRole("button", { name: "Previous day", exact: true }).click();
    await expect(bar.getByRole("tab", { selected: true })).toHaveAccessibleName(/^Sunday 18 Oct/);
    await expect(page.getByText("Wk 42")).toBeVisible();

    await page.getByRole("button", { name: "Next day", exact: true }).click();
    await expect(bar.getByRole("tab", { selected: true })).toHaveAccessibleName(/^Monday 19 Oct/);
    await expect(page.getByText("Wk 43")).toBeVisible();
  });

  test("the week chip shows the week total columns", async ({ page }) => {
    await stub(page);
    await open(page, 375);
    await dayBar(page).getByRole("tab", { name: "Week total" }).click();
    const grid = page.locator("#rag-line-Line-1 table");
    await expect(grid.getByText("Week total")).toBeVisible();
    await expect(page.locator("#rag-line-Line-1").getByRole("row", { name: /^Plan/ })).toContainText("1,800");
  });

  test("a plan being typed survives data arriving and is saved when the day changes", async ({ page }) => {
    // The comments answer late, so they land while the plan is being typed. The
    // board used to remount every line block on any answer, and the typing with it.
    const writes = await stub(page, { slowComments: true });
    await open(page, 375);
    const input = page.locator("#rag-line-Line-2 tbody tr").first().locator("input").first();
    await input.click();
    await input.pressSequentially("1234");
    await page.waitForTimeout(2000);
    await expect(input).toHaveValue("1234");
    await page.getByRole("button", { name: "Next day", exact: true }).click();
    await expect.poll(() => writes.some((w) => (w.body ?? "").includes("1234"))).toBe(true);
  });
});

test.describe("Weekly RAG on tablet and desktop", () => {
  for (const width of [768, 1280]) {
    test(`keeps the whole week at ${width}px`, async ({ page }) => {
      await stub(page);
      await open(page, width);
      await expect(dayBar(page)).toHaveCount(0);
      const grid = page.locator("#rag-line-Line-1 table");
      // Row label + seven days + the week total.
      await expect(grid.locator("thead tr").first().locator("th")).toHaveCount(9);
    });
  }
});
