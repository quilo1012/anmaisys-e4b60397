import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useWoMetrics } from "@/hooks/useWoMetrics";
import { formatDuration } from "@/lib/formatDuration";
import { Clock, XCircle, Users, HelpCircle, Coffee, PowerOff } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWoExclusions } from "@/hooks/useWoExclusions";
import { useDowntimeEvents } from "@/hooks/useDowntimeEvents";
import { activityLabel } from "@/lib/downtimeExclusions";

interface Props {
  workOrderId: string;
}

interface Step {
  label: string;
  ts: string | null;
  metricLabel?: string;
  metricSec?: number | null;
  /** Milestones are the spine of the order; events happened along the way. */
  kind?: "milestone" | "pause" | "stop";
  detail?: string;
}

interface LogEvent {
  id: string;
  engineer_name: string | null;
  action: string;
  created_at: string;
}

export function WoTimeline({ workOrderId }: Props) {
  const { data: m, isLoading } = useWoMetrics(workOrderId);
  const { data: exclusions = [] } = useWoExclusions(workOrderId);
  const { data: stoppages = [] } = useDowntimeEvents(workOrderId);

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
      return ((data as unknown) as LogEvent[]) ?? [];
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

  /**
   * The first stoppage, which is the milestone the rest of the order hangs off.
   *
   * `work_orders.line_stopped_at` is null on 260 of the 349 orders — the stop is
   * recorded as a downtime event and the column on the order was never written, so
   * this row read "not yet" about a line that had demonstrably stopped, on a screen
   * that showed the stop three sections further down.
   *
   * The event is the better source anyway: it carries the reason, and the reason is
   * the first thing anybody opening a work order wants.
   */
  const firstStop = stoppages.find((d) => !d.is_recurrence) ?? stoppages[0] ?? null;
  const stoppedDetail = firstStop
    ? [firstStop.stopped_reason || "no reason recorded", firstStop.stopped_by_name]
        .filter(Boolean)
        .join(" · ")
    : undefined;

  const steps: Step[] = [
    {
      label: "Line stopped",
      ts: m.line_stopped_at ?? firstStop?.stopped_at ?? null,
      detail: stoppedDetail,
    },
    { label: "WO created", ts: m.created_at, metricLabel: "Reporting Delay", metricSec: m.reporting_delay_sec },
    { label: "Engineer accepted", ts: m.accepted_at, metricLabel: "Response Time", metricSec: m.response_time_sec },
    { label: "Engineer arrived", ts: m.arrived_at, metricLabel: "Travel Time", metricSec: m.travel_time_sec },
    { label: "Work started", ts: m.started_at },
    { label: "Work finished", ts: m.finished_at, metricLabel: "Active Repair", metricSec: m.active_repair_sec },
    { label: "Line resumed", ts: m.line_resumed_at, metricLabel: "Restart Delay", metricSec: m.restart_delay_sec },
    { label: "WO closed", ts: m.closed_at, metricLabel: "Paperwork Delay", metricSec: m.paperwork_delay_sec },
  ];

  // What happened between the milestones: the line going down again, and the team
  // stepping away to a break, the blender or the cleaning. The order used to jump
  // from "WO created" to "Line resumed" with no account of the hours in between.
  const events: Step[] = [];
  for (const x of exclusions) {
    events.push({
      label: `Line team on ${activityLabel(x.activity).toLowerCase()}`,
      ts: x.started_at,
      kind: "pause",
      detail: `${x.source === "intouch" ? "reported by iTouching" : `by ${x.started_by_name || "—"}`} · not counted as downtime`,
    });
    if (x.ended_at) {
      events.push({ label: "Back to the stoppage", ts: x.ended_at, kind: "pause", detail: activityLabel(x.activity) });
    }
  }
  // The first stoppage is already the "Line stopped" milestone; only the repeats are
  // news, and they are what a reader cannot otherwise see.
  for (const d of stoppages) {
    if (!d.is_recurrence) continue;
    events.push({
      label: "Line stopped again",
      ts: d.stopped_at,
      kind: "stop",
      detail: `${d.stopped_reason || "no reason recorded"}${d.stopped_by_name ? ` · ${d.stopped_by_name}` : ""}`,
    });
  }

  // Placed by time against the spine, so an event lands after the last milestone that
  // had already happened rather than at the end of the list.
  const timeline: Step[] = [...steps];
  for (const e of events.sort((a, b) => new Date(a.ts!).getTime() - new Date(b.ts!).getTime())) {
    const at = new Date(e.ts!).getTime();
    let idx = 0;
    timeline.forEach((s, i) => { if (s.ts && new Date(s.ts).getTime() <= at) idx = i + 1; });
    timeline.splice(idx, 0, e);
  }

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
          {timeline.map((s, i) => {
            const filled = !!s.ts;
            return (
              <li key={i} className="ml-4">
                {/* Events are marked apart from the milestones: amber for the team
                    stepping away, red for the line going down again. A reader should
                    not have to work out which entries are the order's own spine. */}
                <span
                  className={`absolute -left-1.5 flex h-3 w-3 items-center justify-center rounded-full ${
                    s.kind === "pause" ? "bg-amber-500"
                      : s.kind === "stop" ? "bg-destructive"
                      : filled ? "bg-primary" : "bg-muted"
                  }`}
                />
                <div className="flex items-baseline justify-between gap-3">
                  <p className={`text-sm font-medium ${filled ? "" : "text-muted-foreground"}`}>
                    {s.kind === "pause" && <Coffee className="mr-1 inline h-3 w-3 text-amber-600" />}
                    {s.kind === "stop" && <PowerOff className="mr-1 inline h-3 w-3 text-destructive" />}
                    {s.label}
                  </p>
                  <span className="text-xs font-mono text-muted-foreground">
                    {filled ? format(new Date(s.ts!), "dd/MM HH:mm:ss") : "— not yet"}
                  </span>
                </div>
                {s.detail && <p className="mt-0.5 text-xs text-muted-foreground">{s.detail}</p>}
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
                  <p className="text-sm font-medium text-destructive-strong flex items-center gap-1">
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
