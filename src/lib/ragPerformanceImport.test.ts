import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseRagPerformanceFile } from "./ragPerformanceImport";

// Build a minimal "Production Line Performance" sheet (one line, Mon+Tue) the
// same shape the factory workbook uses, then assert the parser reads it back.
function buildFile(): File {
  const A: (string | number)[][] = [];
  const set = (r: number, c: number, v: string | number) => {
    A[r] = A[r] || [];
    A[r][c] = v;
  };
  set(0, 0, "Applied Nutrition");
  set(1, 0, "Production Line Performance RAG status");
  // dates row (r=3): Monday col2, Tuesday col5
  set(3, 2, "20/07/2026");
  set(3, 5, "21/07/2026");
  // header row (r=4)
  set(4, 1, "Line 1");
  set(4, 2, "Day"); set(4, 3, "Night"); set(4, 4, "Total");
  set(4, 5, "Day"); set(4, 6, "Night"); set(4, 7, "Total");
  // Plan / Actual / Variance / UPM target / UPM actual / Downtime / Comments
  set(5, 1, "Plan"); set(5, 2, 1000); set(5, 3, 800); set(5, 5, 1200);
  set(6, 1, "Actual"); set(6, 2, 950); set(6, 3, 820); set(6, 5, 1100);
  set(7, 1, "Variance");
  set(8, 1, "UPM target"); set(8, 4, 5.5);
  set(9, 1, "UPM actual"); set(9, 4, 5.2);
  set(10, 1, "Downtime"); set(10, 4, "0:45");
  set(11, 1, "Comments"); set(11, 2, "Blender down Monday");

  const ws = XLSX.utils.aoa_to_sheet(A);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "WC 200726");
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return { arrayBuffer: async () => out } as unknown as File;
}

describe("parseRagPerformanceFile", () => {
  const KNOWN = ["Line 1", "Capsules & Tablets", "GEL Machine"];

  it("reads plan/actual/upm/downtime and comments from the standard layout", async () => {
    const res = await parseRagPerformanceFile(buildFile(), KNOWN);
    const by = new Map(res.rows.map((r) => [`${r.entry_date}|${r.line}|${r.shift}`, r]));

    const monDay = by.get("2026-07-20|Line 1|DAY")!;
    expect(monDay.plan_qty).toBe(1000);
    expect(monDay.actual_qty).toBe(950);
    expect(monDay.upm_target).toBe(5.5);
    expect(monDay.upm_actual).toBe(5.2);
    expect(monDay.downtime_min).toBe(45);

    const monNight = by.get("2026-07-20|Line 1|NIGHT")!;
    expect(monNight.plan_qty).toBe(800);
    expect(monNight.actual_qty).toBe(820);

    const tueDay = by.get("2026-07-21|Line 1|DAY")!;
    expect(tueDay.plan_qty).toBe(1200);

    expect(res.comments).toContainEqual({ line: "Line 1", week_start: "2026-07-20", comment: "Blender down Monday" });
  });

  it("maps the 'Tablet line' label to Capsules & Tablets", async () => {
    const A: (string | number)[][] = [];
    const set = (r: number, c: number, v: string | number) => { A[r] = A[r] || []; A[r][c] = v; };
    set(3, 2, "20/07/2026");
    set(4, 1, "Tablet line"); set(4, 2, "Day"); set(4, 3, "Night"); set(4, 4, "Total");
    set(5, 1, "Plan"); set(5, 2, 500);
    const ws = XLSX.utils.aoa_to_sheet(A);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "WC 200726");
    const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const res = await parseRagPerformanceFile({ arrayBuffer: async () => out } as unknown as File, ["Capsules & Tablets"]);
    expect(res.linesDetected).toContain("Capsules & Tablets");
    expect(res.rows.find((r) => r.line === "Capsules & Tablets")?.plan_qty).toBe(500);
  });
});
