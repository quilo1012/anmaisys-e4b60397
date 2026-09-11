import { describe, it, expect } from "vitest";
import { applyActions, type Context } from "../../supabase/functions/_shared/safetyculture/sync";
import type { ScAction } from "../../supabase/functions/_shared/safetyculture/normalize";

/**
 * The sync writes the product the operator named.
 *
 * A SafetyCulture Action has no product field, so the floor writes it into the free
 * text: `Product / BATCH / best-before`. The sync copied that sentence into
 * `description` and stopped — it never named `sku` or `batch` in its payload at all
 * — so on 11/09/2026 all 106 imported rows held NULL in both, and the Quality
 * screen, the PDF and the workbook printed empty columns about actions whose
 * product was written down in as many words.
 *
 * The middle token is a BATCH, not a SKU. `production_items` says A26213 was run as
 * both CRE250 and CRE500, so the batch gives the candidates and the operator's own
 * words break the tie.
 *
 * The rule that matters most here is the one about NOT writing: `sku` and `batch`
 * belong to the PM System, and a person who corrects one by hand must not find it
 * rewritten on the hour. That already happened once, to `validation_status`.
 */

interface Row { id: string; external_id: string; external_updated_at: string | null; validation_status: string | null; sku: string | null; batch: string | null }

/** The three tables this path touches, and nothing else. */
function fakeDb(existing: Row[] = []) {
  const inserted: Record<string, unknown>[] = [];
  const updated: { id: string; patch: Record<string, unknown> }[] = [];
  const production = [
    { batch_code: "A26213", sku_id: "s-250" },
    { batch_code: "A26213", sku_id: "s-500" },
    { batch_code: "H26251", sku_id: "s-pump" },
  ];
  const skus = [
    { id: "s-250", code: "CRE250", name: "CREATINE MONOHYDRATE POWDER 250g" },
    { id: "s-500", code: "CRE500", name: "CREATINE MONOHYDRATE POWDER 500g" },
    { id: "s-pump", code: "PUMPABETB", name: "ABE PUMP 500G - TIGERS BLOOD" },
  ];

  const db = {
    from(table: string) {
      const q: Record<string, unknown> = {};
      const self = {
        select: () => self,
        eq: () => self,
        in: (col: string, vals: string[]) => { q[col] = vals; return self; },
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        insert: (rows: Record<string, unknown> | Record<string, unknown>[]) => {
          if (table === "quality_actions") inserted.push(...(Array.isArray(rows) ? rows : [rows]));
          return Promise.resolve({ error: null });
        },
        update: (patch: Record<string, unknown>) => ({
          eq: (_c: string, id: string) => {
            if (table === "quality_actions") updated.push({ id, patch });
            return Promise.resolve({ error: null });
          },
        }),
        then: (res: (v: { data: unknown; error: null }) => unknown) => {
          const data =
            table === "quality_actions" ? existing
            : table === "production_items" ? production.filter((p) => (q["batch_code"] as string[] ?? []).includes(p.batch_code))
            : table === "sku_products" ? skus.filter((p) => (q["id"] as string[] ?? []).includes(p.id))
            : [];
          return Promise.resolve(res({ data, error: null }));
        },
      };
      return self;
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- three tables of a fake, not a SupabaseClient
  return { db: db as any, inserted, updated };
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
  id: "sc-1", unique_id: "AC-6467", title: "Pack weight out of spec",
  modified_at: "2026-09-04T09:00:00Z", created_at: "2026-09-04T09:00:00Z", ...over,
});

describe("applyActions — sku and batch", () => {
  it("writes the batch and the SKU the operator's words point to", async () => {
    const { db, inserted } = fakeDb();
    await applyActions(db, [action({ description: "Creatine Monohydrate Unflavoured 250g / A26213 / 08-2026" })], ctx);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].batch).toBe("A26213");
    expect(inserted[0].sku).toBe("CRE250");
    // The note is still the note: reading it does not consume it.
    expect(inserted[0].description).toBe("Creatine Monohydrate Unflavoured 250g / A26213 / 08-2026");
  });

  it("keeps the batch but leaves the SKU null when the words decide nothing", async () => {
    const { db, inserted } = fakeDb();
    await applyActions(db, [action({ description: "Creatine Monohydrate / A26213 / 08-2026" })], ctx);
    expect(inserted[0].batch).toBe("A26213");
    expect(inserted[0].sku).toBeNull();
  });

  it("touches neither column when the note names no product", async () => {
    const { db, inserted } = fakeDb();
    await applyActions(db, [action({ description: "Battery died" })], ctx);
    expect(inserted[0]).not.toHaveProperty("sku");
    expect(inserted[0]).not.toHaveProperty("batch");
  });

  it("never overwrites a SKU somebody typed in by hand", async () => {
    const { db, updated } = fakeDb([
      { id: "row-1", external_id: "sc-1", external_updated_at: "2026-09-01T00:00:00Z", validation_status: "open", sku: "CRE500", batch: null },
    ]);
    await applyActions(db, [action({ description: "Creatine Monohydrate Unflavoured 250g / A26213 / 08-2026", modified_at: "2026-09-05T09:00:00Z" })], ctx);
    expect(updated).toHaveLength(1);
    expect(updated[0].patch).not.toHaveProperty("sku");
    expect(updated[0].patch).not.toHaveProperty("batch");
  });

  it("heals the rows imported before it could read a note, on a re-read of the period", async () => {
    // SafetyCulture will never touch those twelve Actions again, so no later sync
    // would reach them: `external_updated_at` is identical and the page is skipped
    // as unchanged. A full re-read fills the two columns and nothing else.
    const { db, updated } = fakeDb([
      { id: "row-1", external_id: "sc-1", external_updated_at: "2026-09-04T09:00:00Z", validation_status: "validated", sku: null, batch: null },
    ]);
    await applyActions(db, [action({
      description: "Creatine Monohydrate Unflavoured 250g / A26213 / 08-2026",
      modified_at: "2026-09-04T09:00:00Z",
    })], ctx);
    expect(updated).toHaveLength(1);
    expect(updated[0].patch).toEqual({ sku: "CRE250", batch: "A26213" });
  });

  it("leaves an unchanged row that already has a product entirely alone", async () => {
    const { db, updated } = fakeDb([
      { id: "row-1", external_id: "sc-1", external_updated_at: "2026-09-04T09:00:00Z", validation_status: "validated", sku: "CRE500", batch: null },
    ]);
    await applyActions(db, [action({
      description: "Creatine Monohydrate Unflavoured 250g / A26213 / 08-2026",
      modified_at: "2026-09-04T09:00:00Z",
    })], ctx);
    expect(updated).toHaveLength(0);
  });

  it("fills a row that has carried neither since the day it was imported", async () => {
    const { db, updated } = fakeDb([
      { id: "row-1", external_id: "sc-1", external_updated_at: "2026-09-01T00:00:00Z", validation_status: "open", sku: null, batch: "  " },
    ]);
    await applyActions(db, [action({ description: "ABE PUMP Tigers Blood 500g / H26251 / 09-2026", modified_at: "2026-09-05T09:00:00Z" })], ctx);
    expect(updated[0].patch.sku).toBe("PUMPABETB");
    expect(updated[0].patch.batch).toBe("H26251");
  });
});
