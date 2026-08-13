import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * The leader's scorecard on a phone, a line tablet and an office desktop.
 *
 * What is measured here is only what jsdom cannot measure: whether the page fits
 * the width it is given, and whether the things a gloved thumb has to hit are
 * actually big enough. The behaviour — the PIN gate, the refusals, the periods —
 * is covered in src/pages/dashboard/LeaderMyScorecardPage.test.tsx and is not
 * repeated here.
 *
 * Nothing in this file reaches the network. Every request to Supabase is answered
 * from the fixture below, including auth, so the production database is never
 * touched and no real PIN is ever sent.
 */

const PROJECT_REF = "ybtrzqzliepknpzqdajx";
const LEADER = "Kleyve";

/** Far enough out that supabase-js never tries to refresh it over the network. */
const FAKE_SESSION = {
  access_token: "fixture-access-token",
  refresh_token: "fixture-refresh-token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: 4_102_444_800, // 2100-01-01
  user: {
    id: "00000000-0000-4000-8000-000000000001",
    aud: "authenticated",
    role: "authenticated",
    email: "line3@fixture.local",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-01-01T00:00:00Z",
  },
};

const PROFILE = {
  id: FAKE_SESSION.user.id,
  name: "Line 3 Tablet",
  email: FAKE_SESSION.user.email,
  active: true,
  production_line: "Line 3",
};

/**
 * A full card, built to match whatever period the page asks for.
 *
 * Generated from the request rather than hardcoded, because the page derives its
 * dates from the real clock: a fixed date would fall outside the window and the
 * card would render empty, which is the one shape that proves nothing about
 * layout. The content is deliberately awkward — a six-digit work order number, a
 * description long enough to need truncating, two lines and both shifts — since
 * a card that only ever holds short strings never finds an overflow.
 */
function scorecardPayload(body: Record<string, string>) {
  const from = body._from;
  const to = body._to;
  const shift = String(body._shift ?? "all").toUpperCase();
  const rowShift = shift === "ALL" ? "DAY" : shift;
  const line = "Line 3";

  const action = (n: number, over: Record<string, unknown> = {}) => ({
    id: `00000000-0000-4000-8000-00000000000${n}`,
    status: n % 2 ? "complete" : "todo",
    severity: ["low", "medium", "high", "critical"][n % 4],
    recorded_at: `${to}T09:${10 + n}:00Z`,
    labels: ["GMP", "Batch code"],
    department: "Quality",
    line,
    action_no: `QA-2026-00${n}`,
    description:
      "Batch code on the secondary carton did not match the primary — line held while the coder was reset and the affected pallet quarantined for re-checking.",
    shift: rowShift,
    validation_status: "open",
    validated_at: null,
    validated_by: null,
    attachments: null,
    closed_at: null,
    ...over,
  });

  return {
    success: true,
    leader: { id: "l-fixture", name: LEADER, line, lines: ["Line 3", "Line 4"] },
    period: { from, to, shift: shift.toLowerCase() },
    actions: [
      action(1),
      action(2),
      action(3, {
        labels: ["Paperwork"],
        validation_status: "validated",
        validated_at: `${to}T14:30:00Z`,
        validated_by: PROFILE.id,
        attachments: ["a.jpg", "b.pdf"],
      }),
      action(4, { closed_at: `${to}T16:00:00Z` }),
    ],
    completes: [{ action_id: "00000000-0000-4000-8000-000000000001", changed_at: `${to}T15:00:00Z` }],
    sessions: [
      { oee_pct: 71.5, run_time_min: 540, down_time_min: 60, intouch_good_total: 8200, session_date: to, line, shift: rowShift },
      { oee_pct: 64.0, run_time_min: 480, down_time_min: 120, intouch_good_total: 7100, session_date: from, line: "Line 4", shift: rowShift },
    ],
    rag: [
      { entry_date: to, line, shift: rowShift, plan_qty: 9600 },
      { entry_date: from, line: "Line 4", shift: rowShift, plan_qty: 8400 },
    ],
    items: [
      { actual_qty: 8200, target_qty: null },
      { actual_qty: 7100, target_qty: null },
    ],
    work_orders: [
      {
        id: "w1", wo_number: 142, created_at: `${to}T10:05:00Z`, status: "in_progress",
        line_at_time: line, line_stopped: true,
        description: "Filler head 4 leaking at the seal — line stopped, engineer called, awaiting a replacement gasket from stores.",
      },
      {
        id: "w2", wo_number: 143, created_at: `${to}T13:40:00Z`, status: "completed",
        line_at_time: line, line_stopped: false,
        description: "Labeller misfeed on the outer sleeve, cleared without stopping the line.",
      },
    ],
  };
}

/** Everything the app might ask Supabase for, answered locally. */
async function stubSupabase(page: Page) {
  await page.addInitScript(
    ([ref, session]) => {
      window.localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(session));
    },
    [PROJECT_REF, FAKE_SESSION] as const,
  );

  await page.route(/supabase\.co/, async (route: Route) => {
    const url = route.request().url();
    const json = (data: unknown) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });

    if (url.includes("/auth/v1/user")) return json(FAKE_SESSION.user);
    if (url.includes("/auth/v1/token")) return json(FAKE_SESSION);
    if (url.includes("/rpc/get_user_role")) return json("operator");
    if (url.includes("/rpc/list_active_profile_names")) return json([{ id: PROFILE.id, name: "Ana Quality" }]);
    if (url.includes("/rpc/leader_self_scorecard")) {
      let body: Record<string, string> = {};
      try { body = JSON.parse(route.request().postData() ?? "{}"); } catch { /* keep the default */ }
      return json(scorecardPayload(body));
    }
    if (url.includes("/leader_score_weights")) return json({ production_pct: 40, quality_pct: 30, documentation_pct: 30 });
    if (url.includes("/quality_severity_points")) {
      return json([
        { severity: "low", points: 1 }, { severity: "medium", points: 2 },
        { severity: "high", points: 3 }, { severity: "critical", points: 4 },
      ]);
    }
    if (url.includes("/profiles")) return json(PROFILE);
    // Whatever else the layout reaches for — sidebar counts, notifications — is
    // an empty list rather than a hanging request.
    return json([]);
  });
}

/** The one thing jsdom cannot check: does the page fit the width it was given. */
async function assertNoSidewaysScroll(page: Page, where: string) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    widest: (() => {
      let worst = { tag: "", cls: "", right: 0 };
      document.querySelectorAll<HTMLElement>("body *").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.right > worst.right) worst = { tag: el.tagName, cls: String(el.className).slice(0, 80), right: Math.round(r.right) };
      });
      return worst;
    })(),
  }));
  expect(
    overflow.scrollWidth,
    `${where}: page scrolls sideways — widest element ${overflow.widest.tag}.${overflow.widest.cls} reaches ${overflow.widest.right}px`,
  ).toBeLessThanOrEqual(overflow.innerWidth + 1);
}

/**
 * No single word may be broken across lines.
 *
 * index.css sets `overflow-wrap: anywhere` on every div and span inside `main`, so
 * a word too wide for its box is not clipped and does not overflow — it is split
 * wherever it runs out. At 390px the three score components read "PRODUC TION",
 * "QUALIT Y" and "DOCUM ENTATIO N", and no assertion about class names could have
 * seen it. A wrapped line of text lays out as more than one client rect, which is
 * the only reliable way to ask the question.
 */
async function assertNoWordIsBroken(page: Page, where: string) {
  const broken = await page.evaluate(() => {
    const out: string[] = [];
    document.querySelectorAll<HTMLElement>("main p, main span, main div, main li").forEach((el) => {
      const text = (el.textContent ?? "").trim();
      // One word only: anything with a space is allowed to wrap between words.
      if (!text || /\s/.test(text) || el.childElementCount > 0) return;
      const range = document.createRange();
      range.selectNodeContents(el);
      // Distinct line boxes, not rects. `{docs.score}%` in JSX is two adjacent
      // text nodes and lays out as two rects side by side on one line — counting
      // rects reported "95%" and "−5%" as broken words on every viewport.
      const lines = new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top)));
      if (lines.size > 1) out.push(text);
    });
    return out;
  });
  expect(broken, `${where}: these words are split across lines`).toEqual([]);
}

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },    // iPhone 14
  { name: "tablet", width: 820, height: 1180 },   // iPad, portrait — the line tablet
  { name: "desktop", width: 1440, height: 900 },
] as const;

for (const vp of VIEWPORTS) {
  test.describe(`${vp.name} (${vp.width}×${vp.height})`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("the keypad fits, and its targets are big enough to hit", async ({ page }) => {
      await stubSupabase(page);
      await page.goto("/dashboard/leader/scorecard");

      const open = page.getByRole("button", { name: /open my scorecard/i });
      await expect(open).toBeVisible({ timeout: 30_000 });
      await page.screenshot({ path: `e2e/.results/${vp.name}-1-pin.png`, fullPage: true });

      await assertNoSidewaysScroll(page, `${vp.name} keypad`);
      await assertNoWordIsBroken(page, `${vp.name} keypad`);

      // WCAG 2.5.5 asks for 44×44 CSS pixels. Measured, not inferred from a class.
      const button = await open.boundingBox();
      expect(button!.height, "the unlock button is under 44px tall").toBeGreaterThanOrEqual(44);

      const slot = await page.locator(".border-input.h-14").first().boundingBox();
      expect(Math.min(slot!.width, slot!.height), "a PIN slot is under 44px").toBeGreaterThanOrEqual(44);
    });

    test("the full card fits, on both periods", async ({ page }) => {
      await stubSupabase(page);
      await page.goto("/dashboard/leader/scorecard");
      await expect(page.getByRole("button", { name: /open my scorecard/i })).toBeVisible({ timeout: 30_000 });

      await page.locator("input").first().fill("4821");
      await expect(page.getByRole("heading", { name: LEADER })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(/final score/i)).toBeVisible();

      await page.screenshot({ path: `e2e/.results/${vp.name}-2-shift.png`, fullPage: true });
      await assertNoSidewaysScroll(page, `${vp.name} card, this shift`);
      await assertNoWordIsBroken(page, `${vp.name} card, this shift`);

      // Every period button has to stay hittable however long its label runs.
      for (const tab of await page.getByRole("tab").all()) {
        const box = await tab.boundingBox();
        expect(box!.height, "a period button is under 44px tall").toBeGreaterThanOrEqual(44);
      }

      await page.getByRole("tab").nth(1).click();
      await expect(page.getByText(/final score/i)).toBeVisible();
      await page.screenshot({ path: `e2e/.results/${vp.name}-3-month.png`, fullPage: true });
      await assertNoSidewaysScroll(page, `${vp.name} card, this month`);
      await assertNoWordIsBroken(page, `${vp.name} card, this month`);
    });
  });
}

/**
 * The card as it comes out of the printer.
 *
 * The score sits on the brand's navy panel, and a navy block is a solid rectangle of
 * ink on paper with the numbers lost inside it — so the panel goes back to black on
 * white for print. That much is a class; what a class cannot tell you is that
 * index.css prints with `.print-content [class*="flex"] { display: flex !important }`,
 * and that substring catches `flex-1` as well as `flex`. The column holding the bars
 * carried `flex-1`, became a flex ROW on paper, and laid its caption out beside the
 * bars, across the Documentation label. Only a print rendering shows that.
 */
test.describe("on paper", () => {
  test.use({ viewport: { width: 1024, height: 1400 } });

  test("prints the score panel as ink on white, with nothing overlapping", async ({ page }) => {
    await stubSupabase(page);
    await page.goto("/dashboard/leader/scorecard");
    await expect(page.getByRole("button", { name: /open my scorecard/i })).toBeVisible({ timeout: 30_000 });
    await page.locator("input").first().fill("4821");
    await expect(page.getByRole("heading", { name: LEADER })).toBeVisible({ timeout: 15_000 });

    await page.emulateMedia({ media: "print" });
    await page.screenshot({ path: "e2e/.results/print-card.png", fullPage: true });

    const bar = page.getByRole("img", { name: /how this score was built/i });
    const panel = bar.locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]");
    expect(
      await panel.evaluate((el) => getComputedStyle(el).backgroundColor),
      "the score panel would print as a solid block of ink",
    ).toBe("rgb(255, 255, 255)");

    // The caption belongs under the bars. If the column is laid out as a row again it
    // lands beside them, level with the labels, and covers one.
    const caption = page.getByText(/each block is as wide as it counts for/i);
    const barBox = await bar.boundingBox();
    const capBox = await caption.boundingBox();
    expect(capBox!.y, "the caption is level with the bars, not below them").toBeGreaterThan(barBox!.y + barBox!.height - 2);
  });
});
