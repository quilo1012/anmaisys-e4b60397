import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useWoMetrics } from "@/hooks/useWoMetrics";
import { formatDuration } from "@/lib/formatDuration";
import { Clock } from "lucide-react";

interface Props {
  workOrderId: string;
}

interface Step {
  label: string;
  ts: string | null;
  metricLabel?: string;
  metricSec?: number | null;
}

/**
 * Vertical stepper showing the full WO lifecycle with labeled durations.
 * All durations come from v_wo_metrics (single source of truth).
 */
export function WoTimeline({ workOrderId }: Props) {
  const { data: m, isLoading } = useWoMetrics(workOrderId);

  if (isLoading || !m) return null;

  const steps: Step[] = [
    { label: "Line stopped", ts: m.line_stopped_at },
    { label: "WO created", ts: m.created_at, metricLabel: "Reporting Delay", metricSec: m.reporting_delay_sec },
    { label: "Engineer accepted", ts: m.accepted_at, metricLabel: "Response Time", metricSec: m.response_time_sec },
    { label: "Engineer arrived", ts: m.arrived_at, metricLabel: "Travel Time", metricSec: m.travel_time_sec },
    { label: "Work started", ts: m.started_at },
    { label: "Work finished", ts: m.finished_at, metricLabel: "Active Repair", metricSec: m.active_repair_sec },
    { label: "Line resumed", ts: m.line_resumed_at, metricLabel: "Restart Delay", metricSec: m.restart_delay_sec },
    { label: "WO closed", ts: m.closed_at, metricLabel: "Paperwork Delay", metricSec: m.paperwork_delay_sec },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Clock className="h-4 w-4" />
          Lifecycle Timeline
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="relative border-l border-border ml-3 space-y-4">
          {steps.map((s, i) => {
            const filled = !!s.ts;
            return (
              <li key={i} className="ml-4">
                <span
                  className={`absolute -left-1.5 flex h-3 w-3 items-center justify-center rounded-full ${
                    filled ? "bg-primary" : "bg-muted"
                  }`}
                />
                <div className="flex items-baseline justify-between gap-3">
                  <p className={`text-sm font-medium ${filled ? "" : "text-muted-foreground"}`}>
                    {s.label}
                  </p>
                  <span className="text-xs font-mono text-muted-foreground">
                    {filled ? format(new Date(s.ts!), "dd/MM HH:mm:ss") : "— not yet"}
                  </span>
                </div>
                {s.metricLabel && s.metricSec !== null && s.metricSec !== undefined && filled && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {s.metricLabel}: <span className="font-medium text-foreground">{formatDuration(s.metricSec)}</span>
                  </p>
                )}
              </li>
            );
          })}
        </ol>

        {/* Headline numbers */}
        <div className="mt-6 grid grid-cols-2 gap-3 pt-4 border-t">
          <div>
            <p className="text-xs text-muted-foreground">Line Downtime</p>
            <p className="text-lg font-bold">{formatDuration(m.line_downtime_sec)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Active Repair</p>
            <p className="text-lg font-bold">{formatDuration(m.active_repair_sec)}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
