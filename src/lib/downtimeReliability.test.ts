import { describe, it, expect } from "vitest";
import {
  filterWOsByRange,
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

// ── filterWOsByRange ─────────────────────────────────────────────────────────
describe("filterWOsByRange", () => {
  const sample: ReliabilityWO[] = [
    wo({ machine: "M1", created_at: iso("2026-06-20T10:00:00Z") }),
    wo({ machine: "M2", created_at: iso("2026-06-24T08:00:00Z") }),
    wo({ machine: "M3", created_at: iso("2026-06-24T23:30:00Z") }),
    wo({ machine: "M4", created_at: iso("2026-06-25T09:00:00Z") }),
  ];

  it("returns [] when input is null/undefined", () => {
    expect(filterWOsByRange(null, new Date(), new Date())).toEqual([]);
    expect(filterWOsByRange(undefined, new Date(), new Date())).toEqual([]);
  });

  it("includes WOs whose created_at falls on the same day as endDate (uses endOfDay)", () => {
    const start = new Date("2026-06-24T00:00:00Z");
    const end = new Date("2026-06-24T00:00:00Z");
    const out = filterWOsByRange(sample, start, end).map((w) => w.machine);
    expect(out).toContain("M2");
    expect(out).toContain("M3"); // 23:30 same day — must NOT be dropped
    expect(out).not.toContain("M1");
    expect(out).not.toContain("M4");
  });

  it("includes WOs at the exact start boundary", () => {
    const start = new Date("2026-06-24T08:00:00Z");
    const end = new Date("2026-06-24T00:00:00Z");
    const out = filterWOsByRange(sample, start, end).map((w) => w.machine);
    expect(out).toContain("M2");
  });

  it("spans multi-day ranges", () => {
    const start = new Date("2026-06-20T00:00:00Z");
    const end = new Date("2026-06-25T00:00:00Z");
    const out = filterWOsByRange(sample, start, end).map((w) => w.machine);
    expect(out.sort()).toEqual(["M1", "M2", "M3", "M4"]);
  });
});

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


