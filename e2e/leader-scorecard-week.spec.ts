import { expect, test, type Page } from "@playwright/test";

/**
 * The weekly leader scorecard board — `/dashboard/leader-scorecard`
 * (`LeaderScorecardWeekPage`) — end to end: load the week, fill and submit a
 * row, and prove the CAPA gate on a Fail behaves differently from a Not Done.
 *
 * SKIPPED. This spec drives the real application against the real Supabase
 * database (`playwright.config.ts` starts `npm run dev` and points at
 * `http://localhost:8080`, which talks to the live project — nothing here is
 * stubbed the way `leader-scorecard.spec.ts` stubs Supabase). None of this
 * module's migrations have been applied to that database yet: no
 * `leader_weekly_scorecard`, no `leader_line_assignment`, no
 * `scorecard_week_board`. Without them the board's query fails and
 * `LeaderScorecardWeekPage` renders its error banner ("Could not load the
 * week.") with zero rows — every locator below that expects a row, a drawer
 * or a state change would find nothing and the run would be a wall of
 * failures that teach people to stop reading this file.
 *
 * The migrations live in `docs/pending-migrations-apply.sql`; the procedure
 * to apply them is `docs/scorecard-v2-apply.md`. Removing the `.skip` below
 * is the LAST step of that procedure, not an optional tidy-up afterwards —
 * do it only once the procedure has been run against this database and the
 * board actually renders rows.
 *
 * Distinct filename on purpose: `leader-scorecard.spec.ts` covers the other,
 * already-live scorecard (`leader_self_scorecard`, the leader's own PIN-gated
 * card). This one is `leader_weekly_scorecard` / `scorecard_week_board` —
 * different tables, different screen, different route.
 */
test.describe.skip("leader scorecard week", () => {
  test("the board loads and shows the week", async ({ page }) => {
    await page.goto("/dashboard/leader-scorecard");
    await expect(page.getByRole("heading", { name: "Leader scorecard" })).toBeVisible();
    await expect(page.getByText(/week ending/i)).toBeVisible();

    // The board itself: one row per leader/line assignment for the week,
    // rendered as a table with these columns (ScorecardWeekBoard.tsx).
    const table = page.getByRole("table");
    await expect(table).toBeVisible();
    for (const column of ["Leader", "Line", "Volume", "Quality", "H&S", "Overall", "Score", "State"]) {
      await expect(page.getByRole("columnheader", { name: column })).toBeVisible();
    }
  });

  test("fills a week and submits it", async ({ page }) => {
    await page.goto("/dashboard/leader-scorecard");

    // "por preencher" is the state as the database stores it; the screen
    // renders it through stateLabel() as "To fill" (src/lib/scorecardWeek.ts).
    await page.getByRole("row").filter({ hasText: "To fill" }).first().click();

    // The three quality checks are radio groups with three states each —
    // Pass / Fail / Not Done — none pre-selected (QualityPillar.tsx). Each
    // group carries its label as its accessible name (aria-labelledby), so
    // role+name reaches them the way a screen-reader user does; the id-based
    // fallback that used to be here existed only because that name was missing.
    for (const group of ["CCP check", "Starter check", "Volume/weight check"]) {
      await page.getByRole("radiogroup", { name: group }).getByRole("radio", { name: "Pass" }).check();
    }

    await page.getByRole("button", { name: "Submit", exact: true }).click();

    // The button itself flips ("Submit" -> "Submitted") once the write is
    // confirmed by a refetch of `verdict` — see ScorecardEntryDrawer.tsx's
    // comment on why this is read off the query result, not the draft.
    await expect(page.getByRole("button", { name: "Submitted" })).toBeVisible();

    // Closing the drawer and re-reading the board shows the same fact,
    // translated: "submetida" -> "Submitted" (stateLabel()).
    await page.keyboard.press("Escape");
    await expect(page.getByRole("row").filter({ hasText: "Submitted" }).first()).toBeVisible();
  });

  test("refuses to approve a Fail until its CAPA is filled", async ({ page }) => {
    await page.goto("/dashboard/leader-scorecard");
    await page.getByRole("row").filter({ hasText: "To fill" }).first().click();

    await page.getByRole("radiogroup", { name: "CCP check" }).getByRole("radio", { name: "Fail" }).check();

    // QualityPillar shows this sentence only once the server (not the
    // client) has flagged the week as a Fail.
    await expect(page.getByText("Fail — a CAPA is required")).toBeVisible();

    // CapaBlock renders its four fields, and the drawer lists exactly what
    // is missing (approvalBlockers mirrors, but does not replace, the
    // database trigger scorecard_require_capa_before_approval).
    const approve = page.getByRole("button", { name: "Approve", exact: true });
    await expect(approve).toBeDisabled();
    await expect(
      page.getByText("Cannot approve yet — missing: Root cause, Corrective action, CAPA owner, CAPA due date."),
    ).toBeVisible();

    await page.getByLabel("Root cause").fill("Coder reset mid-run, batch code mismatch on secondary carton.");
    await page.getByLabel("Corrective action").fill("Retrained line 3 on coder verification at changeover.");
    await page.getByLabel("CAPA owner").fill("Ana Quality");
    await page.getByLabel("CAPA due date").fill("2026-08-24");

    // Filling the four fields the trigger demands clears the blocker list
    // and the message disappears — the button itself is re-enabled by the
    // same `blockers.length > 0` check that disabled it.
    await expect(page.getByText(/cannot approve yet/i)).not.toBeVisible();
    await expect(approve).toBeEnabled();
  });

  test("no label in the drawer is broken mid-word", async ({ page }) => {
    // index.css sets `overflow-wrap: anywhere` on every div and span inside
    // `main`. A word too wide for its box is therefore not clipped and does not
    // overflow — it is split wherever it runs out, and this repo has shipped
    // "QUALIT Y" and "DOCUM ENTATIO N" that way. The drawer's own labels
    // ("Unplanned downtime (minutes)", "H&S training compliance (0-1)") sit in
    // a narrow three-column grid, which is exactly where it happens.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dashboard/leader-scorecard");
    await page.getByRole("row").filter({ hasText: "To fill" }).first().click();
    await expect(page.getByRole("radiogroup", { name: "CCP check" })).toBeVisible();

    await assertNoWordIsBroken(page, "leader scorecard drawer at 390px");
  });

  test("a Not Done is not asked for a CAPA", async ({ page }) => {
    await page.goto("/dashboard/leader-scorecard");
    await page.getByRole("row").filter({ hasText: "To fill" }).first().click();

    await page.getByRole("radiogroup", { name: "CCP check" }).getByRole("radio", { name: "Not Done" }).check();

    // A different sentence for a different fact: Not Done is a discipline
    // gap, not a product deviation, and CapaBlock never renders for it.
    await expect(page.getByText("Not Done — no product deviation to investigate")).toBeVisible();
    await expect(page.getByText("Fail — a CAPA is required")).not.toBeVisible();
    await expect(page.getByText("CAPA — Fail requires an investigation")).not.toBeVisible();
    await expect(page.getByLabel("Root cause")).not.toBeVisible();

    // Nothing blocks approval on account of a missing CAPA the trigger never
    // asked for in the first place.
    await expect(page.getByText(/cannot approve yet/i)).not.toBeVisible();
  });
});

/**
 * No single word may be broken across lines.
 *
 * Width-based, not height-based: a word that had to be split occupies more
 * horizontal space than the box it was laid into, so the sum of the rendered
 * word's line rects exceeds the element's own width. Measuring rects rather than
 * line tops keeps the assertion honest for a word that wraps into a box wide
 * enough to hold it — the height-based version reads that as broken.
 */
async function assertNoWordIsBroken(page: Page, where: string) {
  const broken = await page.evaluate(() => {
    const out: string[] = [];
    document.querySelectorAll<HTMLElement>("label, p, span, div, li").forEach((el) => {
      const text = (el.textContent ?? "").trim();
      // One word only: anything with a space is allowed to wrap between words.
      if (!text || /\s/.test(text) || el.childElementCount > 0) return;
      const range = document.createRange();
      range.selectNodeContents(el);
      const rects = Array.from(range.getClientRects());
      if (rects.length === 0) return;
      // The word's full rendered width, against the width of the box holding it.
      const rendered = rects.reduce((sum, r) => sum + r.width, 0);
      const box = el.getBoundingClientRect().width;
      if (rendered > box + 1) out.push(text);
    });
    return out;
  });
  expect(broken, `${where}: these words are split across lines`).toEqual([]);
}
