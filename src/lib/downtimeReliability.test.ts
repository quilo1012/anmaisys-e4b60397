import { describe, it, expect } from "vitest";
import {
  buildMachineHistory,
  buildMachineRisks,
  type ReliabilityWO,
} from "@/lib/downtimeReliability";

const iso = (s: string) => new Date(s).toISOString();

function wo(partial: Partial<ReliabilityWO> & { machine: string; created_at: string }): ReliabilityWO {
  return {
    description: "Generic fault",
    ...partial,
  };
}

// filterWOsByRange used to live here. It widened a range to whole local days, which
// is what made "Current shift" on the Downtime page report 35 minutes that belonged
// to the night shift. The page now filters on the exact instants, the helper had no
// callers left, and its tests were failing on the widening they were written to
// protect — so the function is gone rather than left as a trap for the next caller.

// ── buildMachineHistory ──────────────────────────────────────────────────────
describe("buildMachineHistory", () => {
  it("returns [] for empty input", () => {
    expect(buildMachineHistory([])).toEqual([]);
  });

  it("counts WOs per machine and picks the top problem", () => {
    const rows = buildMachineHistory([
      wo({ machine: "Filler 1", created_at: iso("2026-06-24T10:00:00Z"), description: "Leak" }),
      wo({ machine: "Filler 1", created_at: iso("2026-06-24T11:00:00Z"), description: "Leak" }),
      wo({ machine: "Filler 1", created_at: iso("2026-06-24T12:00:00Z"), description: "Jam" }),
      wo({ machine: "Capper", created_at: iso("2026-06-24T09:00:00Z"), description: "Misalign" }),
    ]);
    const filler = rows.find((r) => r.machine === "Filler 1")!;
    expect(filler.count).toBe(3);
    expect(filler.topProblem).toBe("Leak");
    expect(filler.topProblemCount).toBe(2);
    expect(rows[0].machine).toBe("Filler 1"); // sorted by count desc
  });

  it("ignores WOs with no machine", () => {
    const rows = buildMachineHistory([
      wo({ machine: "", created_at: iso("2026-06-24T10:00:00Z") }),
      wo({ machine: "M1", created_at: iso("2026-06-24T10:00:00Z") }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].machine).toBe("M1");
  });

  it("renders '—' as topProblem when descriptions are missing", () => {
    const rows = buildMachineHistory([
      wo({ machine: "M1", created_at: iso("2026-06-24T10:00:00Z"), description: null }),
    ]);
    expect(rows[0].topProblem).toBe("—");
    expect(rows[0].topProblemCount).toBe(0);
  });
});

// ── buildMachineRisks ────────────────────────────────────────────────────────
describe("buildMachineRisks", () => {
  const now = new Date("2026-06-24T12:00:00Z");

  it("returns [] for empty input", () => {
    expect(buildMachineRisks([], now)).toEqual([]);
  });

  it("classifies a single recent failure as MEDIUM via recentRepairAlert", () => {
    const risks = buildMachineRisks(
      [wo({ machine: "M1", created_at: iso("2026-06-24T08:00:00Z") })],
      now,
    );
    expect(risks[0].risk).toBe("MEDIUM");
    expect(risks[0].failures30d).toBe(1);
    expect(risks[0].recentRepairAlert).toBe(true);
    expect(risks[0].mtbfHours).toBeNull();
  });

  it("computes MTBF as average gap in hours for ≥2 failures", () => {
    const risks = buildMachineRisks(
      [
        wo({ machine: "M1", created_at: iso("2026-06-24T00:00:00Z") }),
        wo({ machine: "M1", created_at: iso("2026-06-24T04:00:00Z") }),
        wo({ machine: "M1", created_at: iso("2026-06-24T10:00:00Z") }),
      ],
      now,
    );
    // gaps: 4h, 6h → avg 5h
    expect(risks[0].mtbfHours).toBe(5);
  });

  it("escalates to HIGH when ≥3 occurrences of one problem in 7 days", () => {
    const risks = buildMachineRisks(
      [
        wo({ machine: "M1", created_at: iso("2026-06-22T09:00:00Z"), description: "Leak" }),
        wo({ machine: "M1", created_at: iso("2026-06-23T09:00:00Z"), description: "Leak" }),
        wo({ machine: "M1", created_at: iso("2026-06-24T09:00:00Z"), description: "Leak" }),
      ],
      now,
    );
    expect(risks[0].risk).toBe("HIGH");
    expect(risks[0].recurringProblems).toContain("Leak");
  });

  it("sorts HIGH before MEDIUM before LOW, then by failure count", () => {
    const risks = buildMachineRisks(
      [
        // M_LOW — single old failure (>5 days old, no recent repair)
        wo({ machine: "M_LOW", created_at: iso("2026-06-10T10:00:00Z") }),
        // M_MED — 2 failures, recent
        wo({ machine: "M_MED", created_at: iso("2026-06-23T10:00:00Z") }),
        wo({ machine: "M_MED", created_at: iso("2026-06-24T10:00:00Z") }),
        // M_HIGH — 3x same problem in 7 days
        wo({ machine: "M_HIGH", created_at: iso("2026-06-22T10:00:00Z"), description: "Jam" }),
        wo({ machine: "M_HIGH", created_at: iso("2026-06-23T10:00:00Z"), description: "Jam" }),
        wo({ machine: "M_HIGH", created_at: iso("2026-06-24T10:00:00Z"), description: "Jam" }),
      ],
      now,
    );
    expect(risks.map((r) => r.machine)).toEqual(["M_HIGH", "M_MED", "M_LOW"]);
  });

  it("flags HIGH via mtbfWarning when current gap ≥ 80% of MTBF", () => {
    // Two failures 10h apart → MTBF = 10h. Last one was 9h ago → 9 ≥ 0.8*10.
    const risks = buildMachineRisks(
      [
        wo({ machine: "M1", created_at: iso("2026-06-24T00:00:00Z"), description: "A" }),
        wo({ machine: "M1", created_at: iso("2026-06-24T10:00:00Z"), description: "B" }),
      ],
      new Date("2026-06-24T19:00:00Z"),
    );
    expect(risks[0].mtbfHours).toBe(10);
    expect(risks[0].mtbfWarning).toBe(true);
    expect(risks[0].risk).toBe("HIGH");
  });

  it("flags HIGH via recentRepairAlert + ≥3 failures without recurring problems", () => {
    // 3 distinct problems, spaced so MTBF warning does NOT trigger.
    const risks = buildMachineRisks(
      [
        wo({ machine: "M1", created_at: iso("2026-06-20T12:00:00Z"), description: "A" }),
        wo({ machine: "M1", created_at: iso("2026-06-22T12:00:00Z"), description: "B" }),
        wo({ machine: "M1", created_at: iso("2026-06-24T11:00:00Z"), description: "C" }),
      ],
      new Date("2026-06-24T12:00:00Z"),
    );
    expect(risks[0].recurringProblems).toEqual([]);
    expect(risks[0].mtbfWarning).toBe(false);
    expect(risks[0].recentRepairAlert).toBe(true);
    expect(risks[0].failures30d).toBe(3);
    expect(risks[0].risk).toBe("HIGH");
  });

  it("excludes WOs older than 7 days from the recurring-problem window", () => {
    const risks = buildMachineRisks(
      [
        // Old WO outside the 7-day window — must NOT count toward recurrence
        wo({ machine: "M1", created_at: iso("2026-06-10T10:00:00Z"), description: "Leak" }),
        wo({ machine: "M1", created_at: iso("2026-06-23T10:00:00Z"), description: "Leak" }),
        wo({ machine: "M1", created_at: iso("2026-06-24T10:00:00Z"), description: "Leak" }),
      ],
      new Date("2026-06-24T12:00:00Z"),
    );
    // Only 2 "Leak" entries fall within 7 days → not recurring
    expect(risks[0].recurringProblems).toEqual([]);
  });
});


