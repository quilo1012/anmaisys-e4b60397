import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20261126074500_sku_fill_times_candidates.sql", "utf8");
const json = sql.split("$fill_seed$")[1];
const rows = JSON.parse(json) as Array<{
  machine_name: string; sku_code: string; suggested_seconds: number | null;
  median_seconds: number | null; sample_shifts: number | null;
}>;

describe("uploaded SKU fill-time candidates", () => {
  it("preserves all 827 machine/SKU records without merging identities", () => {
    expect(rows).toHaveLength(827);
    expect(new Set(rows.map((r) => `${r.machine_name}:${r.sku_code}`)).size).toBe(827);
    expect(new Set(rows.map((r) => r.machine_name)).size).toBe(10);
  });

  it("preserves the Line 4 CRE250 candidate and its measurement evidence", () => {
    expect(rows.find((r) => r.machine_name === "Line 4" && r.sku_code === "CRE250")).toMatchObject({
      suggested_seconds: 2.08, median_seconds: 2.28, sample_shifts: 108,
    });
  });

  it("keeps the 22 missing suggestions null rather than inventing speeds", () => {
    expect(rows.filter((r) => r.suggested_seconds === null)).toHaveLength(22);
    expect(rows.find((r) => r.sku_code === "SOLUBRAINFUEL")?.suggested_seconds).toBeNull();
  });
});