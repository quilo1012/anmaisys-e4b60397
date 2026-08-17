import { expect, test } from "@playwright/test";

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
    // Pass / Fail / Not Done — none pre-selected (QualityPillar.tsx). The
    // <RadioGroup> itself carries no accessible name (its visible Label is a
    // plain sibling, not linked by htmlFor/aria-labelledby), so role+name
    // cannot disambiguate "the CCP group" from "the Starter group" — see the
    // report for this gap. Falling back to the ids the component itself
    // assigns (`${key}-${opt}`), which is what QualityPillar.test.tsx does.
    for (const key of ["ccp_check_status", "starter_check_status", "volume_weight_check_status"]) {
      await page.locator(`[id="${key}-Pass"]`).check();
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

    await page.locator('[id="ccp_check_status-Fail"]').check();

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

  test("a Not Done is not asked for a CAPA", async ({ page }) => {
    await page.goto("/dashboard/leader-scorecard");
    await page.getByRole("row").filter({ hasText: "To fill" }).first().click();

    await page.locator('[id="ccp_check_status-Not Done"]').check();

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
