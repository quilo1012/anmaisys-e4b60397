
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export interface ReliabilityWO {
  id?: string;
  machine: string;
  /** production | preventive | warehouse_service. Only the first is a failure. */
  wo_type?: string | null;
  description?: string | null;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
}

export interface MachineHistoryRow {
  machine: string;
  count: number;
  topProblem: string;
  topProblemCount: number;
}

export interface MachineRiskRow {
  machine: string;
  risk: RiskLevel;
  failures30d: number;
  mtbfHours: number | null;
  mtbfWarning: boolean;
  recentRepairAlert: boolean;
  recurringProblems: string[];
  lastFailure: string | null;
}

/**
 * Planned work is not a failure.
 *
 * A preventive job and a warehouse request both live in work_orders, and counting
 * them made a machine look worse the more carefully it was looked after — and put
 * warehouse errands in a machine reliability table.
 */
export function isFailure(wo: ReliabilityWO): boolean {
  const t = wo.wo_type ?? "production";
  return t !== "preventive" && t !== "warehouse_service";
}

export function buildMachineHistory(filteredWOs: ReliabilityWO[]): MachineHistoryRow[] {
  const machineMap: Record<string, { count: number; problems: Record<string, number> }> = {};
  filteredWOs.filter(isFailure).forEach((wo) => {
    if (!wo.machine) return;
    if (!machineMap[wo.machine]) machineMap[wo.machine] = { count: 0, problems: {} };
    const entry = machineMap[wo.machine];
    entry.count++;
    if (wo.description) entry.problems[wo.description] = (entry.problems[wo.description] || 0) + 1;
  });

  return Object.entries(machineMap)
    .map(([machine, data]) => {
      const top = Object.entries(data.problems).sort((a, b) => b[1] - a[1])[0];
      return {
        machine,
        count: data.count,
        topProblem: top ? top[0] : "—",
        topProblemCount: top ? top[1] : 0,
      };
    })
    .sort((a, b) => b.count - a.count)
    .filter((m) => m.count > 0);
}

export function buildMachineRisks(
  filteredWOs: ReliabilityWO[],
  now: Date = new Date(),
): MachineRiskRow[] {
  const failures = filteredWOs.filter(isFailure);
  if (!failures.length) return [];
  const machineMap: Record<string, ReliabilityWO[]> = {};
  failures.forEach((wo) => {
    if (!wo.machine) return;
    if (!machineMap[wo.machine]) machineMap[wo.machine] = [];
    machineMap[wo.machine].push(wo);
  });

  return Object.entries(machineMap)
    .map(([machine, wos]) => {
      const failures = wos.length;
      const sorted = [...wos].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );

      let mtbfHours: number | null = null;
      if (sorted.length >= 2) {
        const gaps: number[] = [];
        for (let i = 1; i < sorted.length; i++) {
          gaps.push(
            (new Date(sorted[i].created_at).getTime() -
              new Date(sorted[i - 1].created_at).getTime()) /
              3600000,
          );
        }
        mtbfHours = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
      }

      // sorted is guaranteed non-empty (each machineMap entry was created from a WO)
      const lastFailureDate = sorted[sorted.length - 1].created_at;
      const hoursSinceLast = (now.getTime() - new Date(lastFailureDate).getTime()) / 3600000;
      const mtbfWarning = mtbfHours !== null && hoursSinceLast >= mtbfHours * 0.8;
      const recentRepairAlert =
        (now.getTime() - new Date(lastFailureDate).getTime()) / 86400000 < 5;

      const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);
      const recentWOs = wos.filter((w) => new Date(w.created_at) >= sevenDaysAgo);
      const problemCounts: Record<string, number> = {};
      recentWOs.forEach((w) => {
        if (w.description) problemCounts[w.description] = (problemCounts[w.description] || 0) + 1;
      });
      const recurringProblems = Object.entries(problemCounts)
        .filter(([, c]) => c >= 3)
        .map(([p]) => p);

      let risk: RiskLevel = "LOW";
      if (recurringProblems.length > 0 || (recentRepairAlert && failures >= 3) || mtbfWarning) {
        risk = "HIGH";
      } else if (failures >= 2 || recentRepairAlert) {
        risk = "MEDIUM";
      }

      return {
        machine,
        risk,
        failures30d: failures,
        mtbfHours,
        mtbfWarning,
        recentRepairAlert,
        recurringProblems,
        lastFailure: lastFailureDate || null,
      };
    })
    .sort((a, b) => {
      const order: Record<RiskLevel, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
      return order[a.risk] - order[b.risk] || b.failures30d - a.failures30d;
    });
}
