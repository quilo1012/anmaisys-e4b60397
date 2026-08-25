import { describe, expect, it } from "vitest";
import { aggregateLines, buildDailyHistory, type HistoryRagRow, type HistorySession } from "@/lib/productionHistory";

/**
 * The gap this exists for.
 *
 * The printed Production Performance report carried the period's verdict and
 * nothing of how it was reached: 01/08–25/08, one row, Line 6 at 123%. A month
 * that ran level and a month that lost its first week and made it back in the
 * last printed the same page.
 *
 * `buildDailyHistory` is the same arithmetic as the summary tables, run one day
 * at a time. Same routine on purpose — the two grains are read side by side on
 * the same page, and two implementations would eventually disagree there.
 */

const session = (session_date: string, line: string, shift: string, target: number, actual: number, leader: string | null = "Ailton"): HistorySession =>
  ({ session_date, shift, line, leader_name: leader, target, items: [{ actual }] });

const rag = (entry_date: string, line: string, shift: string, plan_qty: number, actual_qty: number): HistoryRagRow =>
  ({ entry_date, line, shift, plan_qty, actual_qty });

describe("buildDailyHistory", () => {
  it("prints every day of the period in the order it happened", () => {
    const rows = buildDailyHistory(
      [session("2026-08-03", "Line 6", "DAY", 0, 1400), session("2026-08-01", "Line 6", "DAY", 0, 1000)],
      [rag("2026-08-01", "Line 6", "DAY", 1200, 1000), rag("2026-08-03", "Line 6", "DAY", 1200, 1400)],
      "__all__",
    );
    expect(rows.map((r) => r.date)).toEqual(["2026-08-01", "2026-08-03"]);
    expect(rows.map((r) => r.actual)).toEqual([1000, 1400]);
    // 02/08 has neither a plan nor production: a Sunday the factory did not run
    // is absent, not a 0% day to answer for.
    expect(rows.some((r) => r.date === "2026-08-02")).toBe(false);
  });

  it("keeps the day, the line and the shift apart", () => {
    const rows = buildDailyHistory(
      [
        session("2026-08-01", "Line 6", "DAY", 0, 1000),
        session("2026-08-01", "Line 6", "NIGHT", 0, 400),
        session("2026-08-01", "Line 1", "DAY", 0, 700),
      ],
      [
        rag("2026-08-01", "Line 6", "DAY", 1000, 1000),
        rag("2026-08-01", "Line 6", "NIGHT", 1000, 400),
        rag("2026-08-01", "Line 1", "DAY", 700, 700),
      ],
      "__all__",
    );
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.line === "Line 6" && r.shift === "NIGHT")[0].eff).toBe(40);
    // A line that made target on days and lost it on nights must not average into
    // one row that happened on neither.
    expect(rows.filter((r) => r.line === "Line 6").map((r) => r.eff).sort((a, b) => a - b)).toEqual([40, 100]);
  });

  it("reads RAG where it exists and the floor's own logs where it does not", () => {
    const rows = buildDailyHistory(
      [session("2026-08-01", "Line 6", "DAY", 1200, 900), session("2026-08-02", "Line 6", "DAY", 0, 1100)],
      [rag("2026-08-01", "Line 6", "DAY", 1200, 1000)],
      "__all__",
    );
    // 01/08: RAG says 1000, the floor logged 900 — RAG wins, as it does upstairs.
    expect(rows.find((r) => r.date === "2026-08-01")!.actual).toBe(1000);
    // 02/08: no RAG row at all, so the day is the floor's own count.
    expect(rows.find((r) => r.date === "2026-08-02")!.actual).toBe(1100);
  });

  it("does not inherit RAG days when the report is filtered to one leader", () => {
    // A RAG row does not say who was leading. Seeding days from it under a leader
    // filter would hand this leader somebody else's day.
    const rows = buildDailyHistory(
      [session("2026-08-01", "Line 6", "DAY", 1200, 1000, "Ailton")],
      [rag("2026-08-01", "Line 6", "DAY", 1200, 1000), rag("2026-08-04", "Line 1", "NIGHT", 900, 800)],
      "Ailton",
    );
    expect(rows.map((r) => r.date)).toEqual(["2026-08-01"]);
    expect(rows[0].target).toBe(1200);
    expect(rows[0].leader).toBe("Ailton");
  });

  it("adds up to the period tables when every day carries its RAG row", () => {
    const sessions = [
      session("2026-08-01", "Line 6", "DAY", 1200, 1000),
      session("2026-08-02", "Line 6", "DAY", 1200, 1400),
    ];
    const ragRows = [rag("2026-08-01", "Line 6", "DAY", 1200, 1000), rag("2026-08-02", "Line 6", "DAY", 1200, 1400)];
    const daily = buildDailyHistory(sessions, ragRows, "__all__");
    const period = aggregateLines(sessions, ragRows, "__all__");
    expect(daily.reduce((a, r) => a + r.actual, 0)).toBe(period[0].actual);
    expect(daily.reduce((a, r) => a + r.target, 0)).toBe(period[0].target);
  });

  it("keeps a day stored under an unexpected shift instead of dropping it", () => {
    const rows = buildDailyHistory(
      [session("2026-08-01", "Line 6", "TWILIGHT", 500, 480)],
      [],
      "__all__",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].shift).toBe("TWILIGHT");
  });
});
