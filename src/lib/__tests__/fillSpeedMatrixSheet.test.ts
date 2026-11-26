import { describe, it, expect } from "vitest";
import { exportRows, importRows } from "@/lib/fillSpeedMatrixSheet";
import { OTHER_MACHINES } from "@/lib/timeMotionMatrix";

const units = (n: string) => OTHER_MACHINES.find((m) => m.name === n)!.rows[0].fillsPerCycle;
describe("fill speed matrix sheet", () => {
  it("units per cycle: Capsules 1 = 5, Capsules 2 = 21, Gel = 2", () => {
    expect(units("Capsules Machine 1")).toBe(5);
    expect(units("Capsules Machine 2")).toBe(21);
    expect(units("Gel Machine")).toBe(2);
  });
  it("round-trips an edited Line 4 250 g fill time", () => {
    const rows = exportRows({ "line:4:0.25": 2.4 });
    const r = importRows(rows);
    expect(r.overrides).toEqual({ "line:4:0.25": 2.4 });
    expect(r.skipped).toEqual([]);
  });
  it("skips unknown keys", () => {
    const r = importRows([["Key", "Fill time (s)"], ["line:9:1", "3"]]);
    expect(r.updated).toBe(0);
    expect(r.skipped.length).toBe(1);
  });
});
