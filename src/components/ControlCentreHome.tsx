import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useWorkOrders } from "@/hooks/useWorkOrders";
import { useLineLiveStatus } from "@/hooks/useLineLiveStatus";
import { buildLineStatusRows } from "@/lib/lineStatusPanel";
import type { LiveReading } from "@/lib/lineLiveStatus";
import { usePredictiveAlerts } from "@/hooks/usePredictiveAlerts";
import { usePmSchedules, pmStatus } from "@/hooks/usePreventiveMaintenance";
import { useRole } from "@/hooks/useRole";
import { buildOpportunities } from "@/components/PreventiveOpportunities";
import { severityPoints } from "@/lib/qualityConstants";
import { AlertTriangle, Factory, ShieldCheck, ClipboardList, ArrowRight, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The factory in one screen, built only from numbers the system actually holds.
 *
 * What is deliberately NOT here, and why:
 *   · OEE — no production session carries oee_pct. Not one of the 216 this month.
 *   · Overtime today / this week — overtime is recorded per four-to-five week payroll
 *     period. There is no daily figure to show, and dividing a period by its days
 *     would be arithmetic dressed as measurement.
 *   · Safety — the system holds no safety data at all.
 *   · CAPA, and Changeover as a line state — neither concept exists in the schema.
 *
 * A control centre that shows a plausible number for something nobody measured is
 * worse than one with a gap: the gap prompts someone to go and measure it.
 */

type LineRow = { id: string; name: string };

export function ControlCentreHome() {
  const navigate = useNavigate();
  const { can } = useRole();

  // A tile is a door. Showing one to somebody the door will not open for is worse
  // than showing nothing: they click, get refused, and learn to distrust the screen.
  // The maintenance manager has pm.view and downtime.view but not quality.view, and
  // the Quality tile was being offered to them anyway.
  const showProduction = can("downtime.view");
  const showWorkOrders = can("wo.view");
  const showQuality = can("quality.view");
  const showPm = can("pm.view");

  // Reuses the same hook the rest of the app reads work orders through, so the home
  // cannot disagree with the list a click away.
  const { data: workOrders, isLoading: loadingWOs } = useWorkOrders();
  const { alerts, machineRisks } = usePredictiveAlerts();
  const { data: pmSchedules } = usePmSchedules();
  // The same rows, through the same query key, that the production board reads.
  const { data: liveRows = [] } = useLineLiveStatus();

  const { data: lines } = useQuery({
    queryKey: ["lines_min"],
    queryFn: async (): Promise<LineRow[]> => {
      const { data, error } = await supabase.from("lines").select("id, name").order("name");
      if (error) throw error;
      return (data ?? []) as LineRow[];
    },
  });

  const { data: qualityActions } = useQuery({
    queryKey: ["cc_quality_open"],
    enabled: can("quality.view"),
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const { data, error } = await (supabase as any)
        .from("quality_actions")
        .select("id, status, severity, labels, validation_status, line, leader_name, recorded_at")
        .gte("recorded_at", since);
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string; status: string; severity: string | null; labels: string[] | null;
        validation_status: string | null; line: string | null; leader_name: string | null;
      }>;
    },
  });

  const wo = useMemo(() => {
    const rows = (workOrders ?? []) as any[];
    const live = rows.filter((w) => !["closed", "completed", "force_closed"].includes(w.status));
    const open = live.filter((w) => w.status === "open" || w.status === "in_progress");
    return {
      corrective: open.filter((w) => (w.wo_type ?? "production") === "production").length,
      preventive: open.filter((w) => w.wo_type === "preventive").length,
      awaiting: rows.filter((w) => w.status === "finished").length,
      notAccepted: rows.filter((w) => w.status === "open" && !w.received_at).length,
      stoppedNow: rows.filter((w) => w.line_stopped && !w.line_resumed_at && !["closed", "completed", "force_closed"].includes(w.status)),
    };
  }, [workOrders]);

  // The panel's second hand. The live read arrives every 20s, and a stop counter
  // that jumped twenty seconds at a time would read as broken.
  const [second, setSecond] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSecond((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const lineState = useMemo(() => {
    // A line's state is iTouching's to report — see `lineStatusPanel.ts` for the
    // ten green lines this panel used to print over six stopped machines.
    const liveByLine = new Map<string, LiveReading>();
    for (const r of liveRows) {
      liveByLine.set(String(r.line ?? "").trim().toLowerCase(), {
        status: r.status,
        reason: r.reason,
        planned: r.planned,
        seenAt: r.seen_at ? new Date(r.seen_at) : null,
        stopSince: r.stop_since ? new Date(r.stop_since) : null,
      });
    }
    // And an open order saying the line is stopped stays its own separate fact.
    const stoppedByLine = new Map<string, number>();
    for (const w of wo.stoppedNow) {
      const name = (w.line_at_time || "").trim();
      if (name) stoppedByLine.set(name, (stoppedByLine.get(name) ?? 0) + 1);
    }
    return buildLineStatusRows(lines ?? [], liveByLine, stoppedByLine, new Date());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `second` is the ticker that re-runs the clock
  }, [lines, liveRows, wo.stoppedNow, second]);

  const quality = useMemo(() => {
    const rows = qualityActions ?? [];
    const standing = rows.filter((a) => a.validation_status !== "rejected");
    const open = standing.filter((a) => a.status !== "complete");
    return {
      open: open.length,
      points: standing.reduce((s, a) => s + severityPoints(a.severity), 0),
      severe: open.filter((a) => a.severity === "high" || a.severity === "critical").length,
      awaitingVerdict: standing.filter((a) => !["validated", "rejected"].includes(a.validation_status ?? "open")).length,
      paperwork: standing.filter((a) => (a.labels ?? []).includes("Paperwork") && a.validation_status === "validated").length,
    };
  }, [qualityActions]);

  const opportunities = useMemo(() => buildOpportunities((workOrders ?? []) as any[]), [workOrders]);
  const pmOverdue = useMemo(() => (pmSchedules ?? []).filter((s) => pmStatus(s) === "overdue").length, [pmSchedules]);
  const criticalMachines = useMemo(() => machineRisks.filter((m) => m.risk === "HIGH"), [machineRisks]);

  /** Everything that wants a person, worst first. */
  const criticalAlerts = useMemo(() => {
    const out: Array<{ key: string; label: string; detail: string; tone: "danger" | "warning"; to: string }> = [];
    // This one stays the WORK ORDER's claim, not iTouching's, because that is what
    // it links to and what wants a person: an engineer was called out and nobody
    // has resumed the line. A planned clean is a stopped machine and is nobody's
    // emergency; it belongs on the panel below, not in this list.
    const stoppedLines = lineState.filter((l) => l.woStopped > 0);
    if (stoppedLines.length && showWorkOrders) {
      out.push({
        key: "down", tone: "danger", label: `${stoppedLines.length} line${stoppedLines.length === 1 ? "" : "s"} down`,
        detail: stoppedLines.map((l) => l.name).join(", "), to: "/dashboard/work-orders?status=open",
      });
    }
    if (wo.notAccepted && showWorkOrders) {
      out.push({ key: "unaccepted", tone: "danger", label: `${wo.notAccepted} order${wo.notAccepted === 1 ? "" : "s"} nobody has accepted`, detail: "No engineer has taken these", to: "/dashboard/work-orders?status=open" });
    }
    if (quality.severe && showQuality) {
      out.push({ key: "sev", tone: "danger", label: `${quality.severe} High / Critical quality action${quality.severe === 1 ? "" : "s"} open`, detail: "Raised in the last 30 days", to: "/dashboard/quality" });
    }
    if (wo.awaiting && showWorkOrders) {
      out.push({ key: "signoff", tone: "warning", label: `${wo.awaiting} waiting for sign-off`, detail: "Finished, waiting for the maintenance manager", to: "/dashboard/work-orders?status=finished" });
    }
    if (pmOverdue && showPm) {
      out.push({ key: "pm", tone: "warning", label: `${pmOverdue} preventive job${pmOverdue === 1 ? "" : "s"} overdue`, detail: "Past the scheduled date", to: "/dashboard/preventive" });
    }
    if (quality.awaitingVerdict && showQuality) {
      out.push({ key: "verdict", tone: "warning", label: `${quality.awaitingVerdict} quality action${quality.awaitingVerdict === 1 ? "" : "s"} waiting on Quality`, detail: "No verdict yet, so no score has moved", to: "/dashboard/quality" });
    }
    return out;
  }, [lineState, wo, quality, pmOverdue, showQuality, showPm, showWorkOrders]);

  if (loadingWOs) return <Skeleton className="h-64" />;

  // Counted off iTouching, so the tile and the panel below it cannot say different
  // numbers. A line this board cannot read is in neither count — it is not running
  // and it is not stopped, it is unreadable, and the panel says which.
  const linesRunning = lineState.filter((l) => l.live.state === "RUNNING").length;
  const linesDown = lineState.filter((l) =>
    l.live.state === "PLANNED_STOP" || l.live.state === "UNPLANNED_STOP" || l.live.state === "STOPPED_NO_CODE",
  ).length;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {showProduction && (
        <Tile
          title="Production"
          icon={<Factory className="h-4 w-4" />}
          onClick={() => navigate("/dashboard/downtime")}
          rows={[
            { label: "Running", value: linesRunning, tone: "ok" },
            { label: "Down", value: linesDown, tone: linesDown ? "danger" : "muted" },
            { label: "Lines on file", value: lines?.length ?? 0 },
          ]}
        />
        )}
        {showWorkOrders && (
        <Tile
          title="Work orders"
          icon={<ClipboardList className="h-4 w-4" />}
          onClick={() => navigate("/dashboard/work-orders")}
          rows={[
            { label: "Corrective", value: wo.corrective, tone: wo.corrective ? "warning" : "muted" },
            { label: "Preventive", value: wo.preventive, tone: "ok" },
            { label: "Awaiting sign-off", value: wo.awaiting, tone: wo.awaiting ? "warning" : "muted" },
          ]}
        />
        )}
        {showQuality && (
        <Tile
          title="Quality"
          icon={<ShieldCheck className="h-4 w-4" />}
          onClick={() => navigate("/dashboard/quality")}
          rows={[
            { label: "Open actions", value: quality.open, tone: quality.open ? "warning" : "ok" },
            { label: "High / Critical", value: quality.severe, tone: quality.severe ? "danger" : "muted" },
            { label: "Waiting on Quality", value: quality.awaitingVerdict, tone: "muted" },
          ]}
          footer={`${quality.points} severity points in 30 days · ${quality.paperwork} validated paperwork`}
        />
        )}
        {showPm && (
        <Tile
          title="PM intelligence"
          icon={<Wrench className="h-4 w-4" />}
          onClick={() => navigate("/dashboard/pm-intelligence")}
          rows={[
            { label: "Preventive opportunities", value: opportunities.length, tone: opportunities.length ? "warning" : "ok" },
            { label: "Machines at high risk", value: criticalMachines.length, tone: criticalMachines.length ? "danger" : "muted" },
            { label: "Predictive alerts", value: alerts.length, tone: "muted" },
          ]}
        />
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-warning-strong" /> Needs a person
            </CardTitle>
            <CardDescription>Worst first. Empty is the good outcome.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {criticalAlerts.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Nothing outstanding: no line down, every order accepted, nothing waiting for sign-off.
              </p>
            ) : (
              criticalAlerts.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  onClick={() => navigate(a.to)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg border p-2 text-left transition-colors hover:bg-accent/50",
                    a.tone === "danger" ? "border-destructive/40 bg-destructive/5" : "border-warning/40 bg-warning/5",
                  )}
                >
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", a.tone === "danger" ? "bg-destructive" : "bg-warning")} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{a.label}</span>
                    <span className="block truncate text-2xs text-muted-foreground">{a.detail}</span>
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              ))
            )}
          </CardContent>
        </Card>

        {showProduction && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Line status</CardTitle>
            <CardDescription>Straight from iTouching, in its own words. Worst first.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-1.5 sm:grid-cols-2">
            {(lineState ?? []).map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => navigate(`/dashboard/downtime?line=${encodeURIComponent(l.name)}`)}
                className="flex items-center gap-2 rounded-lg border p-2 text-left text-sm transition-colors hover:bg-accent/50"
                title={[
                  l.live.ageSeconds == null
                    ? "iTouching has never reported this machine"
                    : `iTouching, read ${l.live.ageSeconds}s ago${l.live.rawStatus != null ? ` · status ${l.live.rawStatus}` : ""}`,
                  l.woStopped ? `${l.woStopped} open work order says this line is stopped` : null,
                ].filter(Boolean).join(" · ")}
              >
                {/* iTouching's own hue, at full strength in the dot and nowhere else:
                    twelve colours picked for a white industrial panel cannot all be
                    read against a dark theme. Grey where this board cannot say. */}
                <span
                  className={cn("h-2.5 w-2.5 shrink-0 rounded-full", l.hue ? "" : "bg-muted-foreground")}
                  style={l.hue ? { backgroundColor: l.hue } : undefined}
                />
                <span className="min-w-0 flex-1 truncate">{l.name}</span>
                {/* Verbatim, and NOT uppercased — "No Planned Shift", "Line
                    Preparation", "Deep Clean" are the words on the iTouching screen,
                    and the person reading both must not have to translate. */}
                <Badge variant="outline" className="shrink-0 text-2xs">
                  {l.live.label}{l.stopFor ? ` · ${l.stopFor}` : ""}
                </Badge>
                {/* An engineer was called out and nobody resumed the line: its own
                    fact, and it earns its own mark rather than overwriting the state. */}
                {l.woStopped > 0 && <Wrench className="h-3 w-3 shrink-0 text-destructive-strong" />}
              </button>
            ))}
          </CardContent>
        </Card>
        )}
      </div>

      {showPm && opportunities.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div>
              <CardTitle className="text-base">Preventive opportunities</CardTitle>
              <CardDescription>Problems that came back on the same line in the last 30 days.</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => navigate("/dashboard/pm-intelligence")}>
              Plan work <ArrowRight className="ml-1 h-3 w-3" />
            </Button>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {opportunities.slice(0, 6).map((o) => (
              <div key={o.line} className="rounded-lg border p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-semibold">{o.line}</span>
                  <span className="shrink-0 font-figure text-2xs text-muted-foreground">{o.issues[0].count}×</span>
                </div>
                <div className="truncate text-2xs text-muted-foreground">{o.issues[0].description}</div>
                <div className="truncate text-2xs text-muted-foreground">{o.issues[0].machine}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Tile({
  title, icon, rows, footer, onClick,
}: {
  title: string;
  icon: React.ReactNode;
  rows: Array<{ label: string; value: number; tone?: "ok" | "warning" | "danger" | "muted" }>;
  footer?: string;
  onClick?: () => void;
}) {
  const toneClass = {
    ok: "text-success-strong",
    warning: "text-warning-strong",
    danger: "text-destructive-strong",
    muted: "text-muted-foreground",
  } as const;
  return (
    <Card className="cursor-pointer transition-shadow hover:shadow-md" onClick={onClick}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide">
          {icon} {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-2">
            <span className="truncate text-xs text-muted-foreground">{r.label}</span>
            <span className={cn("font-figure text-xl font-bold", r.tone && toneClass[r.tone])}>{r.value}</span>
          </div>
        ))}
        {footer && <p className="pt-1 text-2xs text-muted-foreground">{footer}</p>}
      </CardContent>
    </Card>
  );
}

export default ControlCentreHome;
