import { describe, it, expect } from "vitest";
import { buildRagWorkbookBuffer, type RagFill } from "./ragTemplateExport";
import { parseRagTemplateFile } from "./ragTemplateImport";

// Wrap an ArrayBuffer as the minimal File shape the parser needs (no DOM).
function asFile(buf: ArrayBuffer): File {
  return { arrayBuffer: async () => buf } as unknown as File;
}

describe("RAG template export ↔ import round-trip", () => {
  const weekStart = new Date(2026, 6, 20); // Mon 20 Jul 2026
  const lines = ["Line 1", "Capsules & Tablets"];

  // date|line|shift -> values
  const data: Record<string, { plan?: number; actual?: number; upmTarget?: number; upmActual?: number; downtime?: number }> = {
    "2026-07-20|Line 1|DAY": { plan: 1000, actual: 950, upmTarget: 60, upmActual: 57, downtime: 45 },
    "2026-07-20|Line 1|NIGHT": { plan: 800, actual: 820, upmTarget: 60, upmActual: 61, downtime: 0 },
    "2026-07-22|Line 1|DAY": { plan: 1200, actual: 1100 },
    "2026-07-21|Capsules & Tablets|NIGHT": { plan: 500, actual: 480, downtime: 120 },
  };
  const comments: Record<string, string> = {
    "Line 1": "Blender B down Tuesday AM",
    "Capsules & Tablets": "Good week overall",
  };

  const fill: RagFill = {
    get: (line, dateStr, shift) => data[`${dateStr}|${line}|${shift}`],
    comment: (line) => comments[line],
  };

  // 20s, against ~2s in isolation. Not a slow test — a test whose work is real: it
  // builds an xlsx workbook and parses it back, which is CPU-bound, and vitest runs
  // 150+ files in parallel. On 19/08 it took 5.09s against the default 5000ms budget
  // and failed the suite while passing on its own, which is the worst way for a test
  // to fail: it accuses the change under review of something it did not do.
  //
  // The budget is raised rather than the work reduced. Trimming the fixture down to fit
  // 5s would drop the round-trip coverage this file exists for, to buy back time on a
  // test that is not slow — it is merely honest about what importing a spreadsheet costs.
  it("re-imports every value that was exported", async () => {
    const buf = await buildRagWorkbookBuffer(weekStart, lines, fill);
    const result = await parseRagTemplateFile(asFile(buf), lines);

    const byKey = new Map(result.rows.map((r) => [`${r.entry_date}|${r.line}|${r.shift}`, r]));

    const d = byKey.get("2026-07-20|Line 1|DAY");
    expect(d).toBeDefined();
    expect(d!.plan_qty).toBe(1000);
    expect(d!.actual_qty).toBe(950);
    expect(d!.upm_target).toBe(60);
    expect(d!.upm_actual).toBe(57);
    expect(d!.downtime_min).toBe(45);

    const n = byKey.get("2026-07-20|Line 1|NIGHT");
    expect(n!.plan_qty).toBe(800);
    expect(n!.actual_qty).toBe(820);

    const capsNight = byKey.get("2026-07-21|Capsules & Tablets|NIGHT");
    expect(capsNight!.plan_qty).toBe(500);
    expect(capsNight!.downtime_min).toBe(120);
  }, 20_000);

  it("round-trips per-line comments", async () => {
    const buf = await buildRagWorkbookBuffer(weekStart, lines, fill);
    const result = await parseRagTemplateFile(asFile(buf), lines);
    const cMap = new Map(result.comments.map((c) => [c.line, c.comment]));
    expect(cMap.get("Line 1")).toBe("Blender B down Tuesday AM");
    expect(cMap.get("Capsules & Tablets")).toBe("Good week overall");
  });

  it("does not invent rows for empty cells", async () => {
    const buf = await buildRagWorkbookBuffer(weekStart, lines, fill);
    const result = await parseRagTemplateFile(asFile(buf), lines);
    // Only the 4 seeded (date|line|shift) slots carry data.
    expect(result.rows.length).toBe(4);
    // The "All Lines" totals block must never be imported as a line.
    expect(result.rows.every((r) => lines.includes(r.line))).toBe(true);
  });

  it("blank template yields no rows", async () => {
    const buf = await buildRagWorkbookBuffer(weekStart, lines);
    const result = await parseRagTemplateFile(asFile(buf), lines);
    expect(result.rows.length).toBe(0);
  });
});
