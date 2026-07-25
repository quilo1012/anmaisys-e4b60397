import { describe, it, expect } from "vitest";
import { buildRagPerformanceBuffer } from "./ragPerformanceExport";
import { parseRagPerformanceFile } from "./ragPerformanceImport";
import type { RagFill } from "./ragTemplateExport";

function asFile(buf: ArrayBuffer): File {
  return { arrayBuffer: async () => buf } as unknown as File;
}

describe("RAG performance export ↔ import round-trip", () => {
  const weekStart = new Date(2026, 6, 20); // Mon 20 Jul 2026
  const lines = ["Line 1", "Capsules & Tablets"];
  const data: Record<string, { plan?: number; actual?: number; downtime?: number }> = {
    "2026-07-20|Line 1|DAY": { plan: 3535, actual: 0, downtime: 735 },
    "2026-07-20|Line 1|NIGHT": { plan: 3000, actual: 0 },
    "2026-07-24|Line 1|DAY": { plan: 1834, actual: 1792 },
    "2026-07-24|Capsules & Tablets|DAY": { plan: 8584, actual: 8795 },
  };
  const comments: Record<string, string> = { "Line 1": "Blender B down Monday" };
  const fill: RagFill = {
    get: (line, dateStr, shift) => data[`${dateStr}|${line}|${shift}`],
    comment: (line) => comments[line],
  };

  it("re-imports the plan/actual/downtime and comments it exported", async () => {
    const buf = await buildRagPerformanceBuffer(weekStart, lines, fill);
    const res = await parseRagPerformanceFile(asFile(buf), lines);
    const by = new Map(res.rows.map((r) => [`${r.entry_date}|${r.line}|${r.shift}`, r]));

    const monDay = by.get("2026-07-20|Line 1|DAY")!;
    expect(monDay.plan_qty).toBe(3535);
    expect(monDay.downtime_min).toBe(735);
    expect(by.get("2026-07-20|Line 1|NIGHT")!.plan_qty).toBe(3000);

    const fri = by.get("2026-07-24|Line 1|DAY")!;
    expect(fri.plan_qty).toBe(1834);
    expect(fri.actual_qty).toBe(1792);

    const caps = by.get("2026-07-24|Capsules & Tablets|DAY")!;
    expect(caps.actual_qty).toBe(8795);

    expect(res.linesDetected).toEqual(expect.arrayContaining(["Line 1", "Capsules & Tablets"]));
    expect(res.comments).toContainEqual({ line: "Line 1", week_start: "2026-07-20", comment: "Blender B down Monday" });
  });
});
