import { describe, it, expect } from "vitest";
import {
  computeScorecard, actionsInPeriod, workOrdersInPeriod,
  EMPTY_RAW, type LSAction, type LSWorkOrder, type ScorecardPeriod,
} from "@/lib/leaderScorecard";

/** These cases test the scorecard's arithmetic, not attribution — nothing is excluded. */
const NOTHING_EXCLUDED = new Set<string>();

const action = (over: Partial<LSAction> = {}): LSAction => ({
  id: "a1", status: "todo", severity: "low", recorded_at: "2026-08-05T10:00:00Z",
  labels: [], department: null, line: "Line 1", action_no: "QA-1", description: "x",
  shift: "DAY", validation_status: "open", validated_at: null, validated_by: null,
  attachments: null, closed_at: null,
  ...over,
});

const wo = (over: Partial<LSWorkOrder> = {}): LSWorkOrder => ({
  id: "w1", wo_number: 1, created_at: "2026-08-05T10:00:00Z", status: "open",
  line_at_time: "Line 1", line_stopped: false, description: "x",
  ...over,
});

const period = (over: Partial<ScorecardPeriod> = {}): ScorecardPeriod => ({
  from: "2026-08-05", to: "2026-08-05", shift: "all", ...over,
});

describe("actionsInPeriod", () => {
  it("keeps a night action written after midnight on the night it belongs to", () => {
    // A night that starts on the 5th is still the 5th's night at 03:00 on the 6th.
    const a = action({ recorded_at: "2026-08-06T03:00:00Z", shift: "NIGHT" });
    expect(actionsInPeriod([a], period())).toHaveLength(1);
  });

  it("drops what falls outside the window", () => {
    const a = action({ recorded_at: "2026-08-07T10:00:00Z" });
    expect(actionsInPeriod([a], period())).toHaveLength(0);
  });

  it("filters by shift when the screen asks for one", () => {
    const day = action({ id: "d", shift: "DAY" });
    const night = action({ id: "n", shift: "NIGHT", recorded_at: "2026-08-05T20:00:00Z" });
    expect(actionsInPeriod([day, night], period({ shift: "DAY" })).map((a) => a.id)).toEqual(["d"]);
    expect(actionsInPeriod([day, night], period({ shift: "NIGHT" })).map((a) => a.id)).toEqual(["n"]);
  });
});

describe("workOrdersInPeriod", () => {
  it("takes the shift from the timestamp, since a work order has no shift column", () => {
    const day = wo({ id: "d", created_at: "2026-08-05T10:00:00Z" });
    const night = wo({ id: "n", created_at: "2026-08-05T20:00:00Z" });
    expect(workOrdersInPeriod([day, night], period({ shift: "DAY" })).map((w) => w.id)).toEqual(["d"]);
    expect(workOrdersInPeriod([day, night], period({ shift: "NIGHT" })).map((w) => w.id)).toEqual(["n"]);
    expect(workOrdersInPeriod([day, night], period())).toHaveLength(2);
  });
});

describe("computeScorecard", () => {
  it("an empty card scores on quality and documentation, and not on production", () => {
    const r = computeScorecard(EMPTY_RAW, period(), { excludedLabels: NOTHING_EXCLUDED });
    expect(r.quality.total).toBe(0);
    expect(r.production.attainment).toBeNull();
    expect(r.score.production.value).toBeNull();
    expect(r.score.quality.value).toBe(100);
    expect(r.score.documentation.value).toBe(100);
  });

  it("attainment counts one RAG plan per line-shift-day, not one per session row", () => {
    const r = computeScorecard({
      ...EMPTY_RAW,
      sessions: [
        { oee_pct: null, run_time_min: null, down_time_min: null, intouch_good_total: null, session_date: "2026-08-05", line: "Line 1", shift: "DAY" },
        { oee_pct: null, run_time_min: null, down_time_min: null, intouch_good_total: null, session_date: "2026-08-05", line: "Line 1", shift: "DAY" },
      ],
      ragRows: [{ entry_date: "2026-08-05", line: "Line 1", shift: "DAY", plan_qty: 1000 }],
      items: [{ actual_qty: 800, target_qty: null }],
    }, period(), { excludedLabels: NOTHING_EXCLUDED });
    expect(r.production.targetQty).toBe(1000);
    expect(r.production.attainment).toBe(80);
  });

  /**
   * A planned shift that logged nothing drags attainment down, and the card had no
   * way to say so.
   *
   * The opposite distortion was already named on screen — output with no RAG plan
   * adds to the numerator and not the denominator, so the percentage reads high. This
   * is the same asymmetry the other way round: 5,000 goes onto the target and nothing
   * onto the actual, and the leader is shown a number that is about an unfilled form
   * rather than about their production. Nobody can argue with a figure whose cause is
   * invisible.
   */
  const sess = (over: Partial<{ session_date: string; line: string; shift: string }> = {}) => ({
    oee_pct: null, run_time_min: null, down_time_min: null, intouch_good_total: null,
    session_date: "2026-08-05", line: "Line 1", shift: "DAY", ...over,
  });

  it("counts a planned line-shift that logged no output at all", () => {
    const r = computeScorecard({
      ...EMPTY_RAW,
      sessions: [sess(), sess({ line: "Line 2" })],
      ragRows: [
        { entry_date: "2026-08-05", line: "Line 1", shift: "DAY", plan_qty: 1000 },
        { entry_date: "2026-08-05", line: "Line 2", shift: "DAY", plan_qty: 1000 },
      ],
      // Line 2 ran and was planned, but nothing was ever logged against it.
      items: [{
        actual_qty: 900, target_qty: null,
        production_sessions: { session_date: "2026-08-05", shift: "DAY", line: "Line 1" },
      }],
    }, period(), { excludedLabels: NOTHING_EXCLUDED });

    expect(r.production.plannedWithoutOutput).toBe(1);
    // 900 of 2000 — the figure the leader is shown, and now explicable.
    expect(r.production.attainment).toBe(45);
  });

  it("does not count a planned line-shift that logged output", () => {
    const r = computeScorecard({
      ...EMPTY_RAW,
      sessions: [sess()],
      ragRows: [{ entry_date: "2026-08-05", line: "Line 1", shift: "DAY", plan_qty: 1000 }],
      items: [{
        actual_qty: 900, target_qty: null,
        production_sessions: { session_date: "2026-08-05", shift: "DAY", line: "Line 1" },
      }],
    }, period(), { excludedLabels: NOTHING_EXCLUDED });
    expect(r.production.plannedWithoutOutput).toBe(0);
  });

  /**
   * The tablet's rows come from a database function whose columns a migration fixes,
   * so they carry no session. Silence is the only honest answer: reporting every
   * planned shift as unlogged would put a warning on the leader's own card about a
   * question this data cannot answer.
   */
  it("says nothing when the caller did not select the session behind each item", () => {
    const r = computeScorecard({
      ...EMPTY_RAW,
      sessions: [sess()],
      ragRows: [{ entry_date: "2026-08-05", line: "Line 1", shift: "DAY", plan_qty: 1000 }],
      items: [{ actual_qty: 900, target_qty: null }],
    }, period(), { excludedLabels: NOTHING_EXCLUDED });
    expect(r.production.plannedWithoutOutput).toBe(0);
  });

  it("matches the RAG line however it was typed", () => {
    const r = computeScorecard({
      ...EMPTY_RAW,
      sessions: [{ oee_pct: null, run_time_min: null, down_time_min: null, intouch_good_total: null, session_date: "2026-08-05", line: "line  1", shift: "day" }],
      ragRows: [{ entry_date: "2026-08-05", line: "Line 1", shift: "DAY", plan_qty: 500 }],
      items: [{ actual_qty: 500, target_qty: null }],
    }, period(), { excludedLabels: NOTHING_EXCLUDED });
    expect(r.production.attainment).toBe(100);
  });

  it("a metric no line reports stays null instead of reading as a perfect zero", () => {
    const r = computeScorecard({
      ...EMPTY_RAW,
      sessions: [{ oee_pct: null, run_time_min: null, down_time_min: null, intouch_good_total: null, session_date: "2026-08-05", line: "Line 1", shift: "DAY" }],
    }, period(), { excludedLabels: NOTHING_EXCLUDED });
    expect(r.production.downtimeH).toBeNull();
    expect(r.production.avgOEE).toBeNull();
  });

  it("only a validated paperwork action costs the documentation penalty", () => {
    const raw = {
      ...EMPTY_RAW,
      actions: [
        action({ id: "1", labels: ["Paperwork"], validation_status: "validated" }),
        action({ id: "2", labels: ["Paperwork"], validation_status: "open" }),
        action({ id: "3", labels: ["Paperwork"], validation_status: "rejected" }),
      ],
    };
    const r = computeScorecard(raw, period(), { excludedLabels: NOTHING_EXCLUDED });
    expect(r.docs.penalised.map((a) => a.id)).toEqual(["1"]);
    expect(r.docs.pending.map((a) => a.id)).toEqual(["2"]);
    expect(r.docs.rejected.map((a) => a.id)).toEqual(["3"]);
    expect(r.docs.score).toBe(95);
    expect(r.docs.impactPct).toBe(5);
  });

  it("says what the pending paperwork could still cost, so a clean box is not a clean record", () => {
    // The verdict rule does not change: only "validated" penalises. What changes is
    // that the card stops reading "100% compliant" while two cases wait for one.
    const r = computeScorecard({
      ...EMPTY_RAW,
      actions: [
        action({ id: "1", labels: ["Paperwork"], validation_status: "open" }),
        action({ id: "2", labels: ["Paperwork"], validation_status: "under_investigation" }),
      ],
    }, period(), { excludedLabels: NOTHING_EXCLUDED });
    expect(r.docs.penalised).toHaveLength(0);
    expect(r.docs.impactPct).toBe(0);
    expect(r.docs.score).toBe(100);
    expect(r.docs.penaltyPct).toBe(5);
    expect(r.docs.pendingImpactPct).toBe(10);
  });

  it("average resolution uses the last time an action was moved to complete", () => {
    const r = computeScorecard({
      ...EMPTY_RAW,
      actions: [action({ id: "a1", status: "complete", recorded_at: "2026-08-05T00:00:00Z" })],
      completes: [
        { action_id: "a1", changed_at: "2026-08-06T00:00:00Z" },
        { action_id: "a1", changed_at: "2026-08-07T00:00:00Z" },
      ],
    }, period({ to: "2026-08-05" }), { excludedLabels: NOTHING_EXCLUDED });
    expect(r.quality.avgResolution).toBe(2);
    expect(r.quality.pctClosed).toBe(100);
  });

  it("a closed action stays in the record it is part of", () => {
    const r = computeScorecard({
      ...EMPTY_RAW,
      actions: [action({ id: "a1", closed_at: "2026-08-06T00:00:00Z" })],
    }, period(), { excludedLabels: NOTHING_EXCLUDED });
    expect(r.actions).toHaveLength(1);
    expect(r.quality.filed).toBe(1);
  });

  it("counts the work orders that stopped the line", () => {
    const r = computeScorecard({
      ...EMPTY_RAW,
      woRequests: [wo({ id: "1", line_stopped: true }), wo({ id: "2", line_stopped: false })],
    }, period(), { excludedLabels: NOTHING_EXCLUDED });
    expect(r.woRequests).toHaveLength(2);
    expect(r.woStopped).toBe(1);
  });

  it("survives a payload with missing arrays, as the RPC path may send", () => {
    const r = computeScorecard({} as never, period(), { excludedLabels: NOTHING_EXCLUDED });
    expect(r.quality.total).toBe(0);
    expect(r.woRequests).toEqual([]);
  });
});
