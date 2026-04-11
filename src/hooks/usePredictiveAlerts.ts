import { useMemo } from "react";
import { useWorkOrders } from "@/hooks/useWorkOrders";
import { subDays, differenceInHours } from "date-fns";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export interface PredictiveAlert {
  machine: string;
  problem: string;
  count: number;
  lastOccurrence: string;
  suggestedAction: string;
  isRecurring7d: boolean;
}

export interface MachineRisk {
  machine: string;
  risk: RiskLevel;
  failures30d: number;
  mtbfHours: number | null;
  mtbfWarning: boolean;
  recentRepairAlert: boolean;
  lastFailure: string | null;
  recurringProblems: string[];
}

export function usePredictiveAlerts() {
  const { data: allWOs } = useWorkOrders();

  const alerts = useMemo(() => {
    if (!allWOs) return [];
    const cutoff30 = subDays(new Date(), 30).toISOString();
    const cutoff7 = subDays(new Date(), 7).toISOString();
    const recentWOs = allWOs.filter((w) => w.created_at >= cutoff30);

    // Group by machine + problem
    const groups: Record<string, { count: number; count7d: number; lastOccurrence: string }> = {};
    recentWOs.forEach((wo) => {
      const key = `${wo.machine}|||${wo.description}`;
      if (!groups[key]) {
        groups[key] = { count: 0, count7d: 0, lastOccurrence: wo.created_at };
      }
      groups[key].count++;
      if (wo.created_at >= cutoff7) groups[key].count7d++;
      if (wo.created_at > groups[key].lastOccurrence) {
        groups[key].lastOccurrence = wo.created_at;
      }
    });

    const predictive: PredictiveAlert[] = [];
    Object.entries(groups).forEach(([key, val]) => {
      if (val.count >= 3) {
        const [machine, problem] = key.split("|||");
        const isRecurring7d = val.count7d >= 3;
        predictive.push({
          machine,
          problem,
          count: val.count,
          lastOccurrence: val.lastOccurrence,
          isRecurring7d,
          suggestedAction: isRecurring7d
            ? `URGENT: "${problem}" on ${machine} occurred ${val.count7d}x in 7 days. Immediate preventive maintenance recommended.`
            : `Schedule preventive maintenance for "${problem}" on ${machine}. ${val.count} occurrences in 30 days.`,
        });
      }
    });

    return predictive.sort((a, b) => b.count - a.count);
  }, [allWOs]);

  // Machine risk assessment
  const machineRisks = useMemo(() => {
    if (!allWOs) return [];
    const cutoff30 = subDays(new Date(), 30).toISOString();
    const now = new Date();
    const recentWOs = allWOs.filter((w) => w.created_at >= cutoff30);

    // Group by machine
    const machineMap: Record<string, typeof recentWOs> = {};
    recentWOs.forEach((wo) => {
      if (!machineMap[wo.machine]) machineMap[wo.machine] = [];
      machineMap[wo.machine].push(wo);
    });

    const risks: MachineRisk[] = [];

    Object.entries(machineMap).forEach(([machine, wos]) => {
      const sorted = [...wos].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      const failures30d = wos.length;
      const lastFailure = sorted[sorted.length - 1]?.created_at || null;

      // MTBF: average time between failures
      let mtbfHours: number | null = null;
      if (sorted.length >= 2) {
        const gaps: number[] = [];
        for (let i = 1; i < sorted.length; i++) {
          gaps.push(differenceInHours(new Date(sorted[i].created_at), new Date(sorted[i - 1].created_at)));
        }
        mtbfHours = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
      }

      // MTBF warning: current gap approaching MTBF
      let mtbfWarning = false;
      if (mtbfHours && lastFailure) {
        const hoursSinceLast = differenceInHours(now, new Date(lastFailure));
        mtbfWarning = hoursSinceLast >= mtbfHours * 0.8;
      }

      // Recent repair alert: last repair < 5 days
      const recentRepairAlert = lastFailure
        ? differenceInHours(now, new Date(lastFailure)) < 120
        : false;

      // Recurring problems (≥3 in 7 days)
      const cutoff7 = subDays(now, 7).toISOString();
      const wos7d = wos.filter((w) => w.created_at >= cutoff7);
      const probCount7d: Record<string, number> = {};
      wos7d.forEach((w) => { probCount7d[w.description] = (probCount7d[w.description] || 0) + 1; });
      const recurringProblems = Object.entries(probCount7d).filter(([, c]) => c >= 3).map(([p]) => p);

      // Risk level
      let risk: RiskLevel = "LOW";
      if (recurringProblems.length > 0 || (recentRepairAlert && failures30d >= 5) || mtbfWarning) {
        risk = "HIGH";
      } else if (failures30d >= 3 || recentRepairAlert) {
        risk = "MEDIUM";
      }

      risks.push({ machine, risk, failures30d, mtbfHours, mtbfWarning, recentRepairAlert, lastFailure, recurringProblems });
    });

    return risks.sort((a, b) => {
      const order: Record<RiskLevel, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
      return order[a.risk] - order[b.risk] || b.failures30d - a.failures30d;
    });
  }, [allWOs]);

  // Machines with predictive alerts
  const predictiveMachines = useMemo(() => new Set(alerts.map((a) => a.machine)), [alerts]);

  return { alerts, predictiveMachines, machineRisks };
}
