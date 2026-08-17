import { describe, expect, it } from "vitest";
import { woStatusCounts, DONE_STATUSES } from "@/lib/woStatusCounts";

/**
 * The regression this exists for.
 *
 * The Analytics KPI row is about the selected period — every card in it carries
 * "No activity in selected period" underneath. In the middle of that row sat
 * "Completed Today", counted over the period's work orders but filtered to the actual
 * calendar day. Select last month and the card read 0 while the line under it said
 * there was no activity in the period: two different claims in one card, and the
 * figure answered a question nobody had asked.
 *
 * Open, In Progress and Completed are now three readings of the same set — the work
 * orders raised in the period — so a reader can hold them against each other.
 */

const wo = (status: string) => ({ status });

describe("woStatusCounts", () => {
  it("counts the three states a reader is shown", () => {
    const r = woStatusCounts([
      wo("open"), wo("open"),
      wo("in_progress"),
      wo("completed"), wo("closed"), wo("finished"),
    ]);
    expect(r).toEqual({ open: 2, inProgress: 1, completed: 3 });
  });

  it("counts every spelling of done, because the log has three", () => {
    for (const s of DONE_STATUSES) {
      expect(woStatusCounts([wo(s)]).completed).toBe(1);
    }
  });

  it("leaves force_closed out of completed, deliberately", () => {
    // A force close is a manager filing an order that was never finished. Counting it
    // as completed would flatter the figure with the orders nobody did.
    const r = woStatusCounts([wo("force_closed")]);
    expect(r.completed).toBe(0);
    expect(r.open).toBe(0);
    expect(r.inProgress).toBe(0);
  });

  it("reads an empty period as three zeros, not as a failure", () => {
    expect(woStatusCounts([])).toEqual({ open: 0, inProgress: 0, completed: 0 });
  });

  it("survives a row with no status", () => {
    expect(woStatusCounts([{ status: null }, { status: undefined }])).toEqual({
      open: 0, inProgress: 0, completed: 0,
    });
  });
});
