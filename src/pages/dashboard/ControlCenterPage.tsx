import { useMemo, useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useMachines, useMoveMachine } from "@/hooks/useMachines";
import { useWorkOrders } from "@/hooks/useWorkOrders";
import { useEngineerScores } from "@/hooks/useEngineerScores";
import { usePredictiveAlerts } from "@/hooks/usePredictiveAlerts";
import {
  Monitor, Loader2, Maximize, Minimize, Trophy, Clock, AlertTriangle, Heart,
  GripVertical, List, PowerOff, Wrench, Activity, Radio, Circle, User, Gauge,
} from "lucide-react";
import { getCurrentFactoryShift } from "@/lib/shifts";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { differenceInMinutes, format, formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { getWoStatusConfig } from "@/lib/woStatusConfig";
import { formatWONumber } from "@/lib/woFormat";
import { cn } from "@/lib/utils";

// Non-numbered zones, in display order. Numbered production lines ("Line 1"…"Line 6")
// are ordered numerically before these by getZones().
const ZONE_ORDER = ["Capsules & Tablets", "Capsules Machine 1", "Capsules Machine 2", "Gel Machine", "Storage", "Maintenance Area"];

/** Numeric index of a "Line N" zone, or null for anything else. */
function lineNumber(zone: string): number | null {
  const m = /^line\s+(\d+)$/i.exec(zone.trim());
  return m ? Number(m[1]) : null;
}

function getZoneFor(m: any): string {
  return (
    (m.line && String(m.line).trim()) ||
    (m.current_line && String(m.current_line).trim()) ||
    (m.fixed_line && String(m.fixed_line).trim()) ||
    (m.current_location && String(m.current_location).trim()) ||
    "Unassigned"
  );
}

function getZones(machines: any[]) {
  const zones = new Set<string>();
  machines.forEach((m) => zones.add(getZoneFor(m)));
  return Array.from(zones).sort((a, b) => {
    // Numbered production lines first, in numeric order (Line 1 → Line 6 → …).
    const an = lineNumber(a), bn = lineNumber(b);
    if (an !== null && bn !== null) return an - bn;
    if (an !== null) return -1;
    if (bn !== null) return 1;
    // Then the known non-numbered zones, then anything else alphabetically.
    const ai = ZONE_ORDER.indexOf(a);
    const bi = ZONE_ORDER.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });
}

const formatDowntime = (mins: number) => {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m`;
};

type LineStatus = "stopped" | "wo_active" | "predictive" | "ok" | "no_itouch";

const lineStatusStyles: Record<LineStatus, { card: string; dot: string; label: string; chip: string }> = {
  stopped: {
    card: "border-red-500/60 bg-red-500/5 ring-2 ring-red-500/40",
    dot: "bg-red-500 animate-pulse shadow-[0_0_12px_rgba(239,68,68,0.8)]",
    label: "Line Stopped",
    chip: "bg-red-500/15 text-red-600 dark:text-red-300 border-red-500/40",
  },
  wo_active: {
    card: "border-amber-500/50 bg-amber-500/5",
    dot: "bg-amber-500 animate-pulse",
    label: "WO in progress",
    chip: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40",
  },
  predictive: {
    card: "border-purple-500/40 bg-purple-500/5",
    dot: "bg-purple-500",
    label: "Predictive risk",
    chip: "bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/40",
  },
  ok: {
    card: "border-border bg-card",
    dot: "bg-emerald-500",
    label: "Running",
    chip: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40",
  },
  no_itouch: {
    card: "border-border bg-card",
    dot: "bg-muted-foreground/50",
    label: "No iTouch",
    chip: "bg-muted text-muted-foreground border-border",
  },
};


export default function ControlCenterPage() {
  const { data: machines, isLoading: machinesLoading } = useMachines();
  const { data: workOrders, isLoading: wosLoading } = useWorkOrders({
    statusIn: ["open", "received", "arrived", "in_progress"] as any,
  });
  const { data: recentWOs } = useWorkOrders();
  const { data: engineerScores } = useEngineerScores();
  const { alerts: predictiveAlerts, predictiveMachines } = usePredictiveAlerts();
  const moveMachine = useMoveMachine();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [draggedMachine, setDraggedMachine] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"visual" | "table">("visual");

  // Realtime — refresh on any WO change
  useEffect(() => {
    const channel = supabase
      .channel(`control_center_${Math.random().toString(36).slice(2, 8)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "work_orders" }, () => {
        queryClient.invalidateQueries({ queryKey: ["work_orders"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "machines" }, () => {
        queryClient.invalidateQueries({ queryKey: ["machines"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "quality_actions" }, () => {
        queryClient.invalidateQueries({ queryKey: ["cc-line-stats"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "production_items" }, () => {
        queryClient.invalidateQueries({ queryKey: ["cc-line-stats"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      const req = document.documentElement.requestFullscreen?.();
      if (req && typeof req.then === "function") {
        req.then(() => setIsFullscreen(true)).catch(() => {});
      } else {
        setIsFullscreen(true);
      }
    } else {
      document.exitFullscreen?.().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const isLoading = machinesLoading || wosLoading;




  // All active lines from DB (so newly-added lines like Line 7 always show up).
  const { data: dbLines } = useQuery({
    queryKey: ["control-center-lines"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lines")
        .select("name,active")
        .eq("active", true);
      if (error) throw error;
      return (data ?? []) as Array<{ name: string; active: boolean }>;
    },
    staleTime: 5 * 60_000,
  });

  // Per-line snapshot for the current factory shift: leader, attainment %, open quality actions.
  const factoryShift = getCurrentFactoryShift();
  const shiftUpper = factoryShift.shiftCode.toUpperCase();
  const { data: lineStats } = useQuery({
    queryKey: ["cc-line-stats", factoryShift.sessionDate, shiftUpper],
    queryFn: async () => {
      const norm = (s: string) => (s || "").trim().toLowerCase();
      type Stat = { leader: string | null; plan: number; actual: number; actions: number };
      const map = new Map<string, Stat>();
      const ensure = (k: string): Stat => {
        let e = map.get(k);
        if (!e) { e = { leader: null, plan: 0, actual: 0, actions: 0 }; map.set(k, e); }
        return e;
      };
      // Sessions for the current shift → leader + which sessions belong to each line.
      const { data: sessions } = await supabase
        .from("production_sessions")
        .select("id, line, leader_name")
        .eq("session_date", factoryShift.sessionDate)
        .eq("shift", shiftUpper);
      const sessLine = new Map<string, string>();
      for (const s of (sessions ?? []) as any[]) {
        const k = norm(s.line);
        const e = ensure(k);
        if (s.leader_name && !e.leader) e.leader = s.leader_name;
        sessLine.set(s.id, k);
      }
      // Production items for those sessions → planned/actual for attainment.
      const ids = Array.from(sessLine.keys());
      if (ids.length) {
        const { data: items } = await supabase
          .from("production_items")
          .select("session_id, planned_qty, actual_qty, target_qty")
          .in("session_id", ids);
        for (const it of (items ?? []) as any[]) {
          const k = sessLine.get(it.session_id);
          if (!k) continue;
          const e = ensure(k);
          e.plan += Number(it.target_qty ?? it.planned_qty ?? 0) || 0;
          e.actual += Number(it.actual_qty ?? 0) || 0;
        }
      }
      // Open quality actions (todo + in_progress) per line.
      const { data: qa } = await supabase
        .from("quality_actions")
        .select("line, status")
        .in("status", ["todo", "in_progress"]);
      for (const r of (qa ?? []) as any[]) {
        if (!r.line) continue;
        ensure(norm(r.line)).actions += 1;
      }
      return map;
    },
    staleTime: 60_000,
  });

  // Distinct line names that have an iTouching mapping.
  const { data: itouchLineSet } = useQuery({
    queryKey: ["control-center-itouch-lines"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("intouch_machine_map")
        .select("line_id, lines:line_id(name)")
        .eq("active", true);
      if (error) throw error;
      const s = new Set<string>();
      (data ?? []).forEach((r: any) => {
        const n = r?.lines?.name;
        if (n) s.add(String(n).trim().toLowerCase());
      });
      return s;
    },
    staleTime: 5 * 60_000,
  });

  const zones = useMemo(() => {
    const all = new Set<string>(machines ? getZones(machines) : []);
    (dbLines ?? []).forEach((l) => all.add(l.name));
    return getZones(Array.from(all).map((name) => ({ line: name })));
  }, [machines, dbLines]);

  const machinesByZone = useMemo(() => {
    const map: Record<string, any[]> = {};
    zones.forEach((z) => (map[z] = []));
    (machines ?? []).forEach((m) => {
      const zone = getZoneFor(m);
      (map[zone] ||= []).push(m);
    });
    return map;
  }, [machines, zones]);

  const wosByZone = useMemo(() => {
    const map: Record<string, any[]> = {};
    if (!workOrders || !machines) return map;
    const machineZone = new Map(machines.map((m: any) => [m.name, getZoneFor(m)]));
    workOrders.forEach((wo: any) => {
      const zone = machineZone.get(wo.machine) || wo.line_at_time || "Unassigned";
      (map[zone] ||= []).push(wo);
    });
    return map;
  }, [workOrders, machines]);

  const hasItouch = useCallback(
    (zone: string) => !!itouchLineSet?.has(zone.trim().toLowerCase()),
    [itouchLineSet],
  );

  const lineStatus = useMemo(() => {
    const map: Record<string, LineStatus> = {};
    zones.forEach((z) => {
      const wos = wosByZone[z] || [];
      const machinesInZone = machinesByZone[z] || [];
      const hasStopped = wos.some((w: any) => w.line_stopped && !w.line_resumed_at);
      const hasWO = wos.length > 0;
      const hasPredictive = machinesInZone.some((m: any) => predictiveMachines.has(m.name));
      if (hasStopped) map[z] = "stopped";
      else if (hasWO) map[z] = "wo_active";
      else if (hasPredictive) map[z] = "predictive";
      else if (!hasItouch(z)) map[z] = "no_itouch";
      else map[z] = "ok";
    });
    return map;
  }, [zones, wosByZone, machinesByZone, predictiveMachines, hasItouch]);


  // KPIs
  const kpis = useMemo(() => {
    const stoppedLines = zones.filter((z) => lineStatus[z] === "stopped").length;
    const openWOs = workOrders?.filter((w: any) => w.status === "open").length ?? 0;
    const inProgressWOs = workOrders?.filter((w: any) => w.status === "in_progress").length ?? 0;
    const totalDowntime = (workOrders || [])
      .filter((w: any) => w.line_stopped && !w.line_resumed_at && w.line_stopped_at)
      .reduce((sum: number, w: any) => sum + differenceInMinutes(new Date(), new Date(w.line_stopped_at)), 0);
    return { stoppedLines, openWOs, inProgressWOs, totalDowntime };
  }, [zones, lineStatus, workOrders]);

  const machineStatusMap = useMemo(() => {
    const map: Record<string, { status: "green" | "yellow" | "red" | "purple"; woCount: number }> = {};
    if (!machines || !workOrders) return map;
    machines.forEach((m: any) => {
      const wos = workOrders.filter((w: any) => w.machine === m.name);
      const isPredictive = predictiveMachines.has(m.name);
      if (!wos.length) map[m.name] = { status: isPredictive ? "purple" : "green", woCount: 0 };
      else {
        const hasOpen = wos.some((w: any) => w.status === "open");
        map[m.name] = { status: hasOpen ? "red" : "yellow", woCount: wos.length };
      }
    });
    return map;
  }, [machines, workOrders, predictiveMachines]);

  const machineChipColors: Record<string, string> = {
    green: "bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-300",
    yellow: "bg-amber-500/15 border-amber-500/40 text-amber-700 dark:text-amber-300",
    red: "bg-red-500/15 border-red-500/50 text-red-700 dark:text-red-300 animate-pulse",
    purple: "bg-purple-500/15 border-purple-500/40 text-purple-700 dark:text-purple-300",
  };

  const getHealthColor = (score: number) => {
    if (score >= 70) return "text-emerald-600 bg-emerald-500/15";
    if (score >= 40) return "text-amber-600 bg-amber-500/15";
    return "text-red-600 bg-red-500/15";
  };

  const top5 = engineerScores?.slice(0, 5) || [];
  const liveFeed = useMemo(() => (recentWOs || []).slice(0, 20), [recentWOs]);

  // Drag and drop
  const handleDragStart = (e: React.DragEvent, machineId: string) => {
    setDraggedMachine(machineId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", machineId);
  };
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };
  const handleDrop = async (e: React.DragEvent, targetZone: string) => {
    e.preventDefault();
    const machineId = e.dataTransfer.getData("text/plain");
    setDraggedMachine(null);
    if (!machineId || !machines) return;
    const machine = machines.find((m: any) => m.id === machineId);
    if (!machine) return;
    const currentZone = getZoneFor(machine);
    if (currentZone === targetZone) return;
    try {
      await moveMachine.mutateAsync({
        machineId: machine.id,
        fromLocation: currentZone,
        toLocation: targetZone,
      });
      toast({ title: "Machine moved", description: `${machine.name} → ${targetZone}` });
    } catch (err: any) {
      toast({ title: "Move failed", description: err.message, variant: "destructive" });
    }
  };

  const tvMode = isFullscreen;

  return (
    <DashboardLayout>
      <div className={cn("space-y-4", tvMode && "p-2")}>
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className={cn("font-bold flex items-center gap-2", tvMode ? "text-lg" : "text-2xl")}>
              <Monitor className={tvMode ? "h-4 w-4" : "h-6 w-6"} /> Control Center
              <span className="inline-flex items-center gap-1 text-xs font-normal text-emerald-600 ml-2">
                <Radio className="h-3 w-3 animate-pulse" /> LIVE
              </span>
            </h2>
            {!tvMode && (
              <p className="text-muted-foreground text-sm">
                Real-time factory map — drag machines between zones
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant={viewMode === "visual" ? "default" : "outline"} size="sm" onClick={() => setViewMode("visual")} className="gap-1">
              <Monitor className="h-4 w-4" /> Map
            </Button>
            <Button variant={viewMode === "table" ? "default" : "outline"} size="sm" onClick={() => setViewMode("table")} className="gap-1">
              <List className="h-4 w-4" /> Table
            </Button>
            <Button variant="outline" size="sm" onClick={toggleFullscreen} className="gap-2">
              {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
              {isFullscreen ? "Exit" : "TV Mode"}
            </Button>
          </div>
        </div>

        {/* KPIs */}
        <div className={cn("grid gap-3", tvMode ? "grid-cols-4" : "grid-cols-2 md:grid-cols-4")}>
          <KpiTile
            icon={<PowerOff className="h-5 w-5" />}
            label="Lines stopped"
            value={kpis.stoppedLines}
            tone={kpis.stoppedLines > 0 ? "danger" : "ok"}
            tvMode={tvMode}
          />
          <KpiTile
            icon={<AlertTriangle className="h-5 w-5" />}
            label="Open WOs"
            value={kpis.openWOs}
            tone={kpis.openWOs > 0 ? "warning" : "ok"}
            tvMode={tvMode}
          />
          <KpiTile
            icon={<Wrench className="h-5 w-5" />}
            label="In progress"
            value={kpis.inProgressWOs}
            tone="info"
            tvMode={tvMode}
          />
          <KpiTile
            icon={<Clock className="h-5 w-5" />}
            label="Live downtime"
            value={kpis.totalDowntime > 0 ? formatDowntime(kpis.totalDowntime) : "—"}
            tone={kpis.totalDowntime > 0 ? "danger" : "ok"}
            tvMode={tvMode}
          />
        </div>

        {/* Predictive banner */}
        {predictiveAlerts.length > 0 && (
          <Alert className="border-purple-500/50 bg-purple-500/10">
            <AlertTriangle className="h-5 w-5 text-purple-600" />
            <AlertTitle className={tvMode ? "text-xs" : "text-sm font-bold"}>
              {predictiveAlerts.length} Predictive Alert(s)
            </AlertTitle>
            <AlertDescription className={tvMode ? "text-[10px]" : "text-xs"}>
              {predictiveAlerts.slice(0, 3).map((a, i) => {
                const cleanProblem = (a.problem ?? "").replace(/\|{2,}/g, "|").replace(/^[\s|¦]+|[\s|¦]+$/g, "").trim();
                return (
                  <span key={i} className="block">
                    {a.machine}: "{cleanProblem}" — {a.count}× in 30 days
                  </span>
                );
              })}
            </AlertDescription>
          </Alert>
        )}

        {viewMode === "table" ? (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Active Work Orders — Realtime</CardTitle>
            </CardHeader>
            <CardContent>
              {!workOrders?.length ? (
                <p className="text-muted-foreground text-center py-8">No active work orders.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Line</TableHead>
                      <TableHead>Machine</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Problem</TableHead>
                      <TableHead>Engineer</TableHead>
                      <TableHead>Downtime</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {workOrders.map((wo: any) => {
                      const machine = machines?.find((m: any) => m.name === wo.machine);
                      const downMin = differenceInMinutes(new Date(), new Date(wo.created_at));
                      const sc = getWoStatusConfig(wo.status);
                      return (
                        <TableRow key={wo.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/dashboard/wo/${wo.id}`)}>
                          <TableCell className="font-medium">{machine ? getZoneFor(machine) : "Unassigned"}</TableCell>
                          <TableCell>{wo.machine || <span className="text-muted-foreground italic">Unassigned</span>}</TableCell>
                          <TableCell><StatusBadge status={wo.status} label={sc.label} /></TableCell>
                          <TableCell className="max-w-[200px] truncate">{wo.description}</TableCell>
                          <TableCell>{wo.engineer_name || "—"}</TableCell>
                          <TableCell className="font-mono">{formatDowntime(downMin)}</TableCell>
                          <TableCell className="text-muted-foreground">{format(new Date(wo.created_at), "dd/MM HH:mm")}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className={cn("grid gap-4", tvMode ? "lg:grid-cols-5" : "lg:grid-cols-4")}>
            {/* Main map */}
            <div className={cn("space-y-3", tvMode ? "lg:col-span-4" : "lg:col-span-3")}>
              {isLoading ? (
                <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
              ) : !machines?.length ? (
                <p className="text-muted-foreground text-center py-16">No machines registered yet.</p>
              ) : (
                zones.map((zone) => {
                  const zoneMachines = machinesByZone[zone] || [];
                  const zoneWOs = wosByZone[zone] || [];
                  const status = lineStatus[zone] || "ok";
                  const sty = lineStatusStyles[status];
                  return (
                    <Card
                      key={zone}
                      className={cn(
                        "transition-all",
                        sty.card,
                        draggedMachine && "ring-2 ring-primary/30 ring-dashed",
                      )}
                      onDragOver={handleDragOver}
                      onDrop={(e) => handleDrop(e, zone)}
                    >
                      <CardHeader className={tvMode ? "pb-1 p-2" : "pb-3"}>
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-3">
                            <span className={cn("inline-block h-3 w-3 rounded-full", sty.dot)} aria-hidden />
                            <CardTitle className={tvMode ? "text-sm font-bold" : "text-lg"}>{zone}</CardTitle>
                            <Badge variant="outline" className={cn("text-[10px]", sty.chip)}>
                              {sty.label}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary" className="text-xs">
                              {zoneMachines.length} machine{zoneMachines.length !== 1 ? "s" : ""}
                            </Badge>
                            {zoneWOs.length > 0 && (
                              <Badge variant="outline" className="text-xs gap-1">
                                <Wrench className="h-3 w-3" /> {zoneWOs.length} WO
                              </Badge>
                            )}
                          </div>
                        </div>
                        {/* Per-line snapshot: shift leader · attainment · open quality actions */}
                        {(() => {
                          const ls = lineStats?.get(zone.trim().toLowerCase());
                          if (!ls || (!ls.leader && ls.plan === 0 && ls.actions === 0)) return null;
                          const attain = ls.plan > 0 ? Math.round((ls.actual / ls.plan) * 100) : null;
                          return (
                            <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5", tvMode ? "text-[10px]" : "text-xs")}>
                              {ls.leader && (
                                <span className="inline-flex items-center gap-1 text-muted-foreground" title="Shift leader">
                                  <User className="h-3 w-3" /> {ls.leader}
                                </span>
                              )}
                              {attain !== null && (
                                <span className={cn("inline-flex items-center gap-1 font-semibold", attain >= 95 ? "text-emerald-600" : attain >= 80 ? "text-amber-600" : "text-destructive")} title="Attainment (actual vs plan)">
                                  <Gauge className="h-3 w-3" /> {attain}%
                                </span>
                              )}
                              {ls.actions > 0 && (
                                <button
                                  type="button"
                                  onClick={() => navigate("/dashboard/quality")}
                                  className="inline-flex items-center gap-1 font-medium text-orange-600 hover:underline"
                                  title="Open quality actions on this line"
                                >
                                  <AlertTriangle className="h-3 w-3" /> {ls.actions} action{ls.actions > 1 ? "s" : ""}
                                </button>
                              )}
                            </div>
                          );
                        })()}
                      </CardHeader>
                      <CardContent className={tvMode ? "p-2 pt-0 space-y-2" : "space-y-3"}>
                        {/* Machine chips */}
                        <div className={cn(
                          "grid gap-1.5",
                          tvMode
                            ? "grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10"
                            : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5",
                        )}>
                          {zoneMachines.map((m: any) => {
                            const ms = machineStatusMap[m.name] || { status: "green" as const, woCount: 0 };
                            const hs = m.health_score ?? 100;
                            return (
                              <HoverCard key={m.id} openDelay={200} closeDelay={100}>
                                <HoverCardTrigger asChild>
                                  <div
                                    draggable
                                    onDragStart={(e) => handleDragStart(e, m.id)}
                                    onDragEnd={() => setDraggedMachine(null)}
                                    onClick={() => navigate(`/dashboard/machines/${encodeURIComponent(m.name)}/history`)}
                                    className={cn(
                                      "border rounded-md cursor-grab active:cursor-grabbing transition-all hover:scale-[1.03]",
                                      machineChipColors[ms.status],
                                      tvMode ? "p-1.5" : "p-2",
                                      draggedMachine === m.id && "opacity-50 scale-95",
                                    )}
                                  >
                                    <p className={cn("font-medium truncate", tvMode ? "text-[10px]" : "text-xs")}>{m.name}</p>
                                    <div className="flex items-center justify-between mt-1">
                                      {ms.woCount > 0 ? (
                                        <span className="text-[10px] font-mono">{ms.woCount} WO</span>
                                      ) : (
                                        <span className="text-[10px] opacity-70">OK</span>
                                      )}
                                      <span className={cn("rounded px-1 font-mono font-bold flex items-center gap-0.5", getHealthColor(hs), tvMode ? "text-[8px]" : "text-[10px]")}>
                                        <Heart className="h-2.5 w-2.5" /> {hs}
                                      </span>
                                    </div>
                                  </div>
                                </HoverCardTrigger>
                                {!tvMode && (
                                  <HoverCardContent className="w-64 text-sm" side="top">
                                    <div className="space-y-1">
                                      <p className="font-bold">{m.name}</p>
                                      {m.code && <p className="text-xs text-muted-foreground font-mono">Code: {m.code}</p>}
                                      <p className="text-xs">Health: <span className={cn("font-bold px-1 rounded", getHealthColor(hs))}>{hs}/100</span></p>
                                      <p className="text-xs">Type: {m.machine_type || "—"}</p>
                                    </div>
                                  </HoverCardContent>
                                )}
                              </HoverCard>
                            );
                          })}
                          {zoneMachines.length === 0 && (
                            <p className="text-muted-foreground text-xs text-center py-3 col-span-full">Drop machines here</p>
                          )}
                        </div>

                        {/* Inline WOs */}
                        {zoneWOs.length > 0 && (
                          <div className="border-t pt-2 space-y-1">
                            {zoneWOs.slice(0, tvMode ? 2 : 5).map((wo: any) => {
                              const sc = getWoStatusConfig(wo.status);
                              const downMin = wo.line_stopped_at
                                ? differenceInMinutes(new Date(), new Date(wo.line_stopped_at))
                                : differenceInMinutes(new Date(), new Date(wo.created_at));
                              return (
                                <button
                                  key={wo.id}
                                  onClick={() => navigate(`/dashboard/wo/${wo.id}`)}
                                  className="w-full flex items-center gap-2 text-left p-2 rounded-md bg-muted/40 hover:bg-muted transition-colors text-xs"
                                >
                                  <span className="font-mono font-bold text-[11px] shrink-0">
                                    {formatWONumber(wo.wo_number, wo.created_at)}
                                  </span>
                                  <StatusBadge status={wo.status} label={sc.label} size="sm" className="shrink-0 text-[10px]" />
                                  <span className="flex-1 truncate text-muted-foreground">
                                    {wo.machine} · {wo.description}
                                  </span>
                                  <span className="text-[11px] text-muted-foreground shrink-0">
                                    {wo.engineer_name || "—"}
                                  </span>
                                  <span className="font-mono text-[11px] shrink-0">
                                    {formatDowntime(downMin)}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </div>

            {/* Sidebar */}
            <div className="space-y-3">
              {/* Live feed */}
              <Card>
                <CardHeader className={tvMode ? "pb-1 p-2" : "pb-3"}>
                  <CardTitle className={cn("flex items-center gap-2", tvMode ? "text-xs" : "text-base")}>
                    <Activity className={tvMode ? "h-3 w-3 text-emerald-500" : "h-4 w-4 text-emerald-500"} />
                    Live Feed
                  </CardTitle>
                </CardHeader>
                <CardContent className={tvMode ? "p-2 pt-0" : "pt-0"}>
                  <ScrollArea className={tvMode ? "h-[180px]" : "h-[320px]"}>
                    {!liveFeed.length ? (
                      <p className="text-muted-foreground text-xs text-center py-4">No recent activity</p>
                    ) : (
                      <div className="space-y-1.5">
                        {liveFeed.map((wo: any) => {
                          const sc = getWoStatusConfig(wo.status);
                          return (
                            <button
                              key={wo.id}
                              onClick={() => navigate(`/dashboard/wo/${wo.id}`)}
                              className="w-full text-left p-2 rounded-md hover:bg-muted transition-colors border border-border/50"
                            >
                              <div className="flex items-center justify-between gap-1">
                                <span className="font-mono text-[10px] font-bold">
                                  {formatWONumber(wo.wo_number, wo.created_at)}
                                </span>
                                <StatusBadge status={wo.status} label={sc.label} size="sm" className="text-[9px] py-0 px-1.5" />
                              </div>
                              <p className={cn("truncate font-medium mt-0.5", tvMode ? "text-[10px]" : "text-xs")}>
                                {wo.machine || "—"}
                              </p>
                              <p className="text-[10px] text-muted-foreground truncate">
                                {wo.description}
                              </p>
                              <div className="flex items-center justify-between mt-0.5 text-[10px] text-muted-foreground">
                                <span className="flex items-center gap-1">
                                  <Circle className="h-1.5 w-1.5 fill-current" />
                                  {formatDistanceToNow(new Date(wo.created_at), { addSuffix: true })}
                                </span>
                                {wo.line_stopped && !wo.line_resumed_at && (
                                  <span className="text-red-500 font-semibold flex items-center gap-0.5">
                                    <PowerOff className="h-2.5 w-2.5" /> stopped
                                  </span>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </ScrollArea>
                </CardContent>
              </Card>

              {/* Top 5 */}
              <Card>
                <CardHeader className={tvMode ? "pb-1 p-2" : "pb-3"}>
                  <CardTitle className={cn("flex items-center gap-2", tvMode ? "text-xs" : "text-base")}>
                    <Trophy className={tvMode ? "h-3 w-3 text-yellow-500" : "h-4 w-4 text-yellow-500"} /> Top 5
                  </CardTitle>
                </CardHeader>
                <CardContent className={tvMode ? "p-2 pt-0" : "pt-0"}>
                  {!top5.length ? (
                    <p className="text-muted-foreground text-xs text-center py-2">No scores yet</p>
                  ) : (
                    <div className="space-y-1.5">
                      {top5.map((eng: any, i: number) => (
                        <div key={eng.id} className="flex items-center gap-2 rounded-md bg-muted/40 p-1.5">
                          <span className="font-bold text-sm w-5 text-center">{i + 1}</span>
                          <p className="flex-1 truncate text-xs font-medium">{eng.engineer_name}</p>
                          <Badge variant={eng.score >= 0 ? "default" : "destructive"} className="text-[10px] px-1.5 py-0">
                            {eng.score}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Legend */}
              {!tvMode && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">Legend</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0 space-y-1.5 text-xs">
                    {(Object.keys(lineStatusStyles) as LineStatus[]).map((k) => (
                      <div key={k} className="flex items-center gap-2">
                        <span className={cn("h-2.5 w-2.5 rounded-full", lineStatusStyles[k].dot)} />
                        <span className="text-muted-foreground">{lineStatusStyles[k].label}</span>
                      </div>
                    ))}
                    <div className="flex items-center gap-2 pt-1 border-t mt-1">
                      <GripVertical className="h-3 w-3 text-muted-foreground" />
                      <span className="text-muted-foreground">Drag chips to relocate machines</span>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

function KpiTile({
  icon, label, value, tone, tvMode,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  tone: "ok" | "warning" | "danger" | "info";
  tvMode: boolean;
}) {
  const toneStyles: Record<string, string> = {
    ok: "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300",
    warning: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    danger: "border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300",
    info: "border-blue-500/30 bg-blue-500/5 text-blue-700 dark:text-blue-300",
  };
  return (
    <Card className={cn("border", toneStyles[tone])}>
      <CardContent className={cn("flex items-center gap-3", tvMode ? "p-2" : "p-4")}>
        <div className="shrink-0 opacity-80">{icon}</div>
        <div className="min-w-0">
          <p className={cn("uppercase tracking-wide opacity-70", tvMode ? "text-[9px]" : "text-[10px]")}>{label}</p>
          <p className={cn("font-bold", tvMode ? "text-lg" : "text-2xl")}>{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
