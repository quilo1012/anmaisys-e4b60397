import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The close counts each person-day once, and it can only do that with the day.
 *
 * `countDaysAway` keys the hand marks against the clocked days on `on_date`. The page
 * selected `employee_id, status` from `employee_attendance`, so every mark arrived
 * without a date, matched no clocked day, and was added on top: a Fri–Mon person read
 * 44 days present in a 35-day period. The unit tests never saw it because they build
 * their rows by hand, with the date.
 */
describe("Finance Close reads the date of every attendance row it counts", () => {
  const page = readFileSync("src/pages/dashboard/FinanceClosePage.tsx", "utf8");

  it.each(["employee_attendance", "attendance_days"])("%s is selected with on_date", (table) => {
    const selects = [...page.matchAll(new RegExp(`from\\("${table}"\\)(?:(?!from\\()[\\s\\S]){0,600}?\\.select\\("([^"]+)"\\)`, "g"))]
      .map((m) => m[1]);
    expect(selects.length).toBeGreaterThan(0);
    // The opening-balance read sums minutes and counts no days, so it may go without.
    const counting = selects.filter((s) => !/^employee_id, balance_minutes$/.test(s));
    expect(counting.length).toBeGreaterThan(0);
    for (const s of counting) expect(s).toMatch(/\bon_date\b/);
  });
});
