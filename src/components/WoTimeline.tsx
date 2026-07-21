import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useWoMetrics } from "@/hooks/useWoMetrics";
import { formatDuration } from "@/lib/formatDuration";
import { Clock, XCircle, Users, HelpCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  workOrderId: string;
}

interface Step {
  label: string;
  ts: string | null;
  metricLabel?: string;
  metricSec?: number | null;
}

interface LogEvent {
  id: string;
  engineer_name: string | null;
  action: string;
  created_at: string;
}

export function WoTimeline({ workOrderId }: Props) {
  const { data: m, isLoading } = useWoMetrics(workOrderId);

  // All operational events from work_order_logs (no whitelist filter)
  const { data: logEvents = [] } = useQuery({
    queryKey: ["wo_log_events", workOrderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_order_logs" as any)
        .select("id, engineer_name, action, created_at")
        .eq("work_order_id", workOrderId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data as LogEvent[]) ?? [];
    },
    enabled: !!workOrderId,
  });

  const declineLogs = logEvents.filter((d) => d.action.startsWith("declined:"));
  const collabLogs = logEvents.filter((d) => d.action === "collaborator_joined");
  const knownActions = new Set(["collaborator_joined", "declined" /* prefix handled above */]);
  const unknownLogs = logEvents.filter((d) => {
    if (d.action.startsWith("declined:")) return false;
    return !knownActions.has(d.action);
  });

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
          {/* Decline events */}
          {declineLogs.map((d) => {
            const reason = d.action.replace(/^declined:\s*/, "");
            return (
              <li key={d.id} className="ml-4">
                <span className="absolute -left-1.5 flex h-3 w-3 items-center justify-center rounded-full bg-destructive" />
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm font-medium text-destructive flex items-center gap-1">
                    <XCircle className="h-3.5 w-3.5" /> Declined by {d.engineer_name}
                  </p>
                  <span className="text-xs font-mono text-muted-foreground">
                    {format(new Date(d.created_at), "dd/MM HH:mm:ss")}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">Reason: {reason}</p>
              </li>
            );
          })}
          {/* Co-engineer joined events */}
          {collabLogs.map((d) => (
            <li key={d.id} className="ml-4">
              <span className="absolute -left-1.5 flex h-3 w-3 items-center justify-center rounded-full bg-blue-500" />
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-medium text-blue-600 dark:text-blue-400 flex items-center gap-1">
                  <Users className="h-3.5 w-3.5" />
                  Co-engineer joined{d.engineer_name ? ` — ${d.engineer_name}` : ""}
                </p>
                <span className="text-xs font-mono text-muted-foreground">
                  {format(new Date(d.created_at), "dd/MM HH:mm:ss")}
                </span>
              </div>
            </li>
          ))}
          {/* Unknown actions (safety net) */}
          {unknownLogs.map((d) => (
            <li key={d.id} className="ml-4">
              <span className="absolute -left-1.5 flex h-3 w-3 items-center justify-center rounded-full bg-muted-foreground" />
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                  <HelpCircle className="h-3.5 w-3.5" />
                  {d.action.replace(/[_-]/g, " ")}
                  {d.engineer_name ? ` — ${d.engineer_name}` : ""}
                </p>
                <span className="text-xs font-mono text-muted-foreground">
                  {format(new Date(d.created_at), "dd/MM HH:mm:ss")}
                </span>
              </div>
            </li>
          ))}
        </ol>

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
