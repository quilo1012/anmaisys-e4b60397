import { describe, it, expect } from "vitest";
import { applyActions, sameInstant, type Context } from "./sync.ts";
import type { ScAction } from "./normalize.ts";

/**
 * The no-change short-circuit could not fire on a single real row.
 *
 * `external_updated_at` is a `timestamptz`. SafetyCulture sends
 * `"2026-09-01T14:14:01.277Z"`; PostgREST hands the same value back out of the column
 * as `"2026-09-01T14:14:01.277+00:00"`. The guard compared them with `===`, so it was
 * asking whether two spellings of one instant are the same string. They never are.
 *
 * Measured against production on 05/10/2026: **303 of the 312 synced actions were
 * rewritten in the last sweep**, on an hour when nothing had changed upstream.
 * `sc_sync_logs` says `updated: 302, unchanged: 0` — and `unchanged: 0` was the tell. A
 * sync that re-reads the entire history and finds *nothing* unchanged is not comparing
 * anything.
 *
 * What it cost is not the writes. That short-circuit is the thing that was supposed to
 * protect a manual correction to `line` or `leader_name`, and neither column is in
 * `trg_log_quality_action_change` — so every overwrite happened without an audit row,
 * which is why it could run for a month without anybody seeing it.
 *
 * WHY THE EXISTING TEST WAS GREEN. `syncWritesTheProduct.test.ts` stores its fixture
 * rows as `"2026-09-01T00:00:00Z"` — the API's spelling, not the column's. The fake db
 * hands back exactly what was put in, so the comparison it exercised was `Z` against
 * `Z`. The fixture modelled the intent and production modelled the storage. Same shape
 * of mistake as theTwoCardsProjectTheSameRow.test.ts, one layer down.
 */

describe("sameInstant", () => {
  it("reads the two spellings of UTC as one instant", () => {
    // The pair that was actually in production, every hour, for 303 rows.
    expect(sameInstant("2026-09-01T14:14:01.277+00:00", "2026-09-01T14:14:01.277Z")).toBe(true);
    expect(sameInstant("2026-09-02T05:38:46.168909+00:00", "2026-09-02T05:38:46.168909Z")).toBe(true);
  });

  it("reads an offset as an instant and not as a prefix", () => {
    expect(sameInstant("2026-09-01T15:14:01.000+01:00", "2026-09-01T14:14:01.000Z")).toBe(true);
    expect(sameInstant("2026-09-01T14:14:01.000+01:00", "2026-09-01T14:14:01.000Z")).toBe(false);
  });

  it("still says no when the instants really differ", () => {
    expect(sameInstant("2026-09-01T14:14:01.277Z", "2026-09-01T14:14:01.278Z")).toBe(false);
    expect(sameInstant("2026-09-01T14:14:01.277Z", "2026-09-04T09:00:00.000Z")).toBe(false);
  });

  it("treats a missing timestamp as a reason to write, never as a match", () => {
    for (const [a, b] of [[null, "2026-09-01T00:00:00Z"], ["2026-09-01T00:00:00Z", null], [null, null], ["", ""]] as const) {
      expect(sameInstant(a, b)).toBe(false);
    }
  });

  it("falls back to the strings for something it cannot parse", () => {
    // Guessing "equal" would skip that row for ever; guessing "different" costs a write.
    expect(sameInstant("not a date", "not a date")).toBe(true);
    expect(sameInstant("not a date", "2026-09-01T00:00:00Z")).toBe(false);
  });
});

interface Row { id: string; external_id: string; external_updated_at: string | null; validation_status: string | null; sku: string | null; batch: string | null }

/** Only the one table this test needs, answering the way PostgREST answers. */
function fakeDb(existing: Row[]) {
  const updated: { id: string; patch: Record<string, unknown> }[] = [];
  const db = {
    from(table: string) {
      const self = {
        select: () => self,
        eq: () => self,
        in: () => self,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        insert: () => Promise.resolve({ error: null }),
        update: (patch: Record<string, unknown>) => ({
          eq: (_c: string, id: string) => {
            if (table === "quality_actions") updated.push({ id, patch });
            return Promise.resolve({ error: null });
          },
        }),
        then: (res: (v: { data: unknown; error: null }) => unknown) =>
          Promise.resolve(res({ data: table === "quality_actions" ? existing : [], error: null })),
      };
      return self;
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- one table of a fake, not a SupabaseClient
  return { db: db as any, updated };
}

const ctx: Context = {
  lineNames: ["Line 1"],
  rules: [],
  leaderAt: () => ({ leader: null, source: "none" }),
  leaderFor: () => null,
  attendance: () => "unknown",
  countsAgainstLeader: () => true,
  requireWorkerEvidence: false,
  priorityOf: () => null,
};

const action = (over: Partial<ScAction> = {}): ScAction => ({
  id: "sc-1", unique_id: "AC-6467", title: "Pack weight out of spec (L1)",
  modified_at: "2026-09-01T14:14:01.277Z", created_at: "2026-09-01T14:14:01.277Z", ...over,
});

/** A row as the column gives it back, which is the whole point of this file. */
const stored = (externalUpdatedAt: string | null, over: Partial<Row> = {}): Row => ({
  id: "row-1", external_id: "sc-1", external_updated_at: externalUpdatedAt,
  validation_status: "open", sku: "CRE500", batch: "A26213", ...over,
});

describe("applyActions leaves an unchanged row alone", () => {
  it("writes nothing when the column and the API name the same instant", async () => {
    const { db, updated } = fakeDb([stored("2026-09-01T14:14:01.277+00:00")]);
    const summary = await applyActions(db, [action()], ctx);
    expect(updated).toHaveLength(0);
    expect(summary.updated).toBe(0);
    expect(summary.unchanged).toBe(1);
  });

  it("still writes when SafetyCulture really did touch it", async () => {
    const { db, updated } = fakeDb([stored("2026-09-01T14:14:01.277+00:00")]);
    const summary = await applyActions(db, [action({ modified_at: "2026-09-04T09:00:00Z" })], ctx);
    expect(updated).toHaveLength(1);
    expect(summary.unchanged).toBe(0);
  });

  /**
   * The reason this matters, stated as the column it protects.
   *
   * `line` and `leader_name` are not in `trg_log_quality_action_change`, so a sync that
   * rewrites them leaves nothing behind. With the guard working, an untouched Action
   * does not reach the payload at all.
   */
  it("does not put a line back over a correction when nothing changed upstream", async () => {
    const { db, updated } = fakeDb([stored("2026-09-01T14:14:01.277+00:00")]);
    await applyActions(db, [action({ title: "Pack weight out of spec (L1)" })], ctx);
    expect(updated.some((u) => "line" in u.patch || "leader_name" in u.patch)).toBe(false);
  });
});
