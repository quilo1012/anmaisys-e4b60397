import { useMemo } from "react";
import { useWorkOrders } from "@/hooks/useWorkOrders";
import { subDays } from "date-fns";

export interface PredictiveAlert {
  machine: string;
  problem: string;
  count: number;
  lastOccurrence: string;
  suggestedAction: string;
}

export function usePredictiveAlerts() {
  const { data: allWOs } = useWorkOrders();

  const alerts = useMemo(() => {
    if (!allWOs) return [];
    const cutoff = subDays(new Date(), 30).toISOString();
    const recentWOs = allWOs.filter((w) => w.created_at >= cutoff);

    // Group by machine + problem
    const groups: Record<string, { count: number; lastOccurrence: string }> = {};
    recentWOs.forEach((wo) => {
      const key = `${wo.machine}|||${wo.description}`;
      if (!groups[key]) {
        groups[key] = { count: 0, lastOccurrence: wo.created_at };
      }
      groups[key].count++;
      if (wo.created_at > groups[key].lastOccurrence) {
        groups[key].lastOccurrence = wo.created_at;
      }
    });

    const predictive: PredictiveAlert[] = [];
    Object.entries(groups).forEach(([key, val]) => {
      if (val.count >= 3) {
        const [machine, problem] = key.split("|||");
        predictive.push({
          machine,
          problem,
          count: val.count,
          lastOccurrence: val.lastOccurrence,
          suggestedAction: `Schedule preventive maintenance for "${problem}" on ${machine}. ${val.count} occurrences in 30 days.`,
        });
      }
    });

    return predictive.sort((a, b) => b.count - a.count);
  }, [allWOs]);

  // Machines with predictive alerts
  const predictiveMachines = useMemo(() => new Set(alerts.map((a) => a.machine)), [alerts]);

  return { alerts, predictiveMachines };
}
