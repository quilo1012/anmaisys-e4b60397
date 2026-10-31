import { test, expect, type Page, type Route } from "@playwright/test";
import { readFile } from "node:fs/promises";

/**
 * The engineer console's Report button, clicked in a real browser.
 *
 * The unit tests prove the text is built from the rows; this proves the button reads
 * them at the click, downloads what was read, and downloads NOTHING when the read
 * fails — the case that used to produce "No issues today". Every Supabase call is
 * answered here; nothing reaches the network.
 */

const PROJECT_REF = "ybtrzqzliepknpzqdajx";
const NOW = new Date("2026-10-29T14:30:00Z"); // GMT: London = UTC

const FAKE_SESSION = {
  access_token: "fixture-access-token",
  refresh_token: "fixture-refresh-token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: 4_102_444_800,
  user: {
    id: "00000000-0000-4000-8000-0000000000e1",
    aud: "authenticated",
    role: "authenticated",
    email: "fixture-engineer@fixture.local",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-01-01T00:00:00Z",
  },
};

const EVENTS = [
  { id: "e1", work_order_id: "w1", stopped_at: "2026-10-29T08:00:00Z", resumed_at: "2026-10-29T08:47:00Z", duration_minutes: 47, stopped_reason: null },
  { id: "e2", work_order_id: "w2", stopped_at: "2026-10-29T13:00:00Z", resumed_at: null, duration_minutes: null, stopped_reason: null },
  { id: "e3", work_order_id: "w3", stopped_at: "2026-10-29T10:00:00Z", resumed_at: "2026-10-29T10:05:00Z", duration_minutes: 5, stopped_reason: null },
];
const WOS = [
  { id: "w1", wo_number: 101, line_at_time: "Line 2", description: "Labeller fault", resolution_notes: "Reset sensor", status: "closed", wo_type: "corrective", line: { name: "Line 2" } },
  { id: "w2", wo_number: 102, line_at_time: null, description: "Filler leak", resolution_notes: null, status: "in_progress", wo_type: "corrective", line: { name: "Line 7" } },
  { id: "w3", wo_number: 103, line_at_time: "Line 3", description: "Jam", resolution_notes: "Cleared", status: "finished", wo_type: "corrective", line: null },
];

/** Every downtime_events URL the page asked for, to check which window it read. */
const asked: string[] = [];

async function stub(page: Page, opts: { failEvents?: boolean } = {}) {
  asked.length = 0;
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(
    ([ref, session]) => window.localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(session)),
    [PROJECT_REF, FAKE_SESSION] as const,
  );
  await page.route(/supabase\.co/, async (route: Route) => {
    const url = route.request().url();
    const json = (data: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
    if (url.includes("/auth/v1/user")) return json(FAKE_SESSION.user);
    if (url.includes("/auth/v1/token")) return json(FAKE_SESSION);
    if (url.includes("/rpc/get_user_role")) return json("engineer");
    if (url.includes("/rpc/has_role") || url.includes("/rpc/is_owner")) return json(false);
    if (url.includes("/rpc/") && /single|maybe/.test(url)) return json(null);
    if (url.includes("/profiles")) {
      return json([{ id: FAKE_SESSION.user.id, name: "Fixture Engineer", email: FAKE_SESSION.user.email, active: true }]);
    }
    if (url.includes("/rest/v1/downtime_events") && url.includes("stopped_at=lt.")) {
      asked.push(decodeURIComponent(url));
      if (opts.failEvents) return json({ message: "upstream timeout" }, 503);
      return json(EVENTS);
    }
    if (url.includes("/rest/v1/work_orders") && url.includes("id=in.")) return json(WOS);
    return json([]);
  });
}

test.use({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });

async function openDialog(page: Page) {
  await page.goto("/dashboard/engineer");
  const button = page.getByRole("button", { name: /^Report$/ });
  await expect(button).toBeVisible({ timeout: 20_000 });
  await button.click();
  const dialog = page.getByRole("dialog", { name: "Maintenance Shift Report" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("Current shift as TXT: the file holds exactly the stops the database returned", async ({ page }) => {
  await stub(page);
  const dialog = await openDialog(page);
  await expect(dialog.getByText("Day Shift · 29/10/2026")).toBeVisible();
  await dialog.getByRole("radio", { name: "TXT" }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("button", { name: "Generate Report" }).click()]);
  expect(download.suggestedFilename()).toBe("Maintenance_Report_Day_Shift_2026-10-29.txt");
  const text = await readFile((await download.path())!, "utf8");
  expect(text.split("\n").slice(0, 3)).toEqual(["**Maintenance Report**", "Shift: Day Shift (06:00–18:00)", "Date: 29/10/2026"]);
  const body = text.slice(text.indexOf("**Stops over 15 minutes**")).split("\n").slice(1, 5);
  expect(body).toEqual([
    "**Line 2:** Reset sensor (WO-101)",
    "Downtime: 47m",
    "**Line 7:** Filler leak (in progress) (WO-102)",
    "Downtime: 90m so far (still stopped)",
  ]);
  expect(text).not.toContain("WO-103");
  expect(text).toContain("- Stops recorded: 3 stops on 3 work orders");
  expect(asked[0]).toContain("stopped_at=lt.2026-10-29T18:00:00.000Z");
  await expect(dialog.getByText("Checked")).toBeVisible();
});

test("Yesterday — Night reads 28/10 18:00 to 29/10 06:00 and names the file after that night", async ({ page }) => {
  await stub(page);
  const dialog = await openDialog(page);
  await dialog.getByRole("radio", { name: "Yesterday — Night" }).click();
  await expect(dialog.getByText("Night Shift · 28/10/2026")).toBeVisible();
  await expect(dialog.getByText("28/10/2026 18:00 → 29/10/2026 06:00 (Europe/London)")).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("button", { name: "Generate Report" }).click()]);
  expect(download.suggestedFilename()).toBe("Maintenance_Report_Night_Shift_2026-10-28.pdf");
  expect(asked[0]).toContain("stopped_at=lt.2026-10-29T06:00:00.000Z");
  expect(asked[0]).toContain("resumed_at.gt.2026-10-28T18:00:00.000Z");
});

test("Custom date, Excel: any earlier day can be chosen", async ({ page }) => {
  await stub(page);
  const dialog = await openDialog(page);
  await dialog.getByLabel("Report date").fill("2026-10-20");
  await dialog.getByRole("radio", { name: "Day Shift (06:00–18:00)" }).click();
  await dialog.getByRole("radio", { name: "Excel" }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("button", { name: "Generate Report" }).click()]);
  expect(download.suggestedFilename()).toBe("Maintenance_Report_Day_Shift_2026-10-20.xlsx");
  expect(asked[0]).toContain("stopped_at=lt.2026-10-20T17:00:00.000Z"); // 18:00 BST
});

test("A shift that has not started cannot be generated", async ({ page }) => {
  await stub(page);
  const dialog = await openDialog(page);
  await dialog.getByRole("radio", { name: "Night Shift (18:00–06:00)" }).click(); // tonight, 29/10 at 14:30
  await expect(dialog.getByText("That shift has not started yet.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Generate Report" })).toBeDisabled();
  expect(asked).toHaveLength(0);
});

test("Nothing is downloaded when the stoppages cannot be read", async ({ page }) => {
  await stub(page, { failEvents: true });
  const dialog = await openDialog(page);
  let downloaded = false;
  page.on("download", () => { downloaded = true; });
  await dialog.getByRole("button", { name: "Generate Report" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Could not read the line stoppages", { timeout: 20_000 });
  await page.waitForTimeout(500);
  expect(downloaded).toBe(false);
});
