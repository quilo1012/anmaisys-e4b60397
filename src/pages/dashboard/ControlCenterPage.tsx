import { useMemo, useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useMachines, useMoveMachine } from "@/hooks/useMachines";
import { useWorkOrders } from "@/hooks/useWorkOrders";
import { useEngineerScores } from "@/hooks/useEngineerScores";
import { usePredictiveAlerts } from "@/hooks/usePredictiveAlerts";
import { Monitor, Loader2, Maximize, Minimize, Trophy, Clock, AlertTriangle, Heart, GripVertical, List } from "lucide-react";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { differenceInMinutes, format } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";

const ZONE_ORDER = ["Line 1", "Line 2", "Line 3", "Line A", "Line B", "Line C", "Storage", "Maintenance Area"];

function getZones(machines: any[]) {
  const zones = new Set<string>();
  machines.forEach((m) => {
    const loc = m.current_location || m.line || "Unassigned";
    zones.add(loc);
  });
  // Sort: known zones first, then alphabetical unknowns
  return Array.from(zones).sort((a, b) => {
    const ai = ZONE_ORDER.indexOf(a);
    const bi = ZONE_ORDER.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });
}

export default function ControlCenterPage() {
  const { data: machines, isLoading: machinesLoading } = useMachines();
  const { data: workOrders, isLoading: wosLoading } = useWorkOrders({ statusIn: ["open", "received", "arrived", "in_progress"] as any });
  const { data: engineerScores } = useEngineerScores();
  const { alerts: predictiveAlerts, predictiveMachines } = usePredictiveAlerts();
  const moveMachine = useMoveMachine();
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [draggedMachine, setDraggedMachine] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"visual" | "table">("visual");

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const isLoading = machinesLoading || wosLoading;

  const zones = useMemo(() => {
    if (!machines) return [];
    return getZones(machines);
  }, [machines]);

  const machinesByZone = useMemo(() => {
    if (!machines) return {};
    const map: Record<string, typeof machines> = {};
    machines.forEach((m) => {
      const zone = m.current_location || m.line || "Unassigned";
      if (!map[zone]) map[zone] = [];
      map[zone].push(m);
    });
    return map;
  }, [machines]);

  const machineStatus = useMemo(() => {
    const map: Record<string, { status: "green" | "yellow" | "red" | "purple"; woCount: number }> = {};
    if (!machines || !workOrders) return map;
    machines.forEach((m) => {
      const wos = workOrders.filter((w) => w.machine === m.name);
      const isPredictive = predictiveMachines.has(m.name);
      if (!wos.length) {
        map[m.name] = { status: isPredictive ? "purple" : "green", woCount: 0 };
      } else {
        const hasOpen = wos.some((w) => w.status === "open");
        map[m.name] = { status: hasOpen ? "red" : "yellow", woCount: wos.length };
      }
    });
    return map;
  }, [machines, workOrders, predictiveMachines]);

  const lineDowntime = useMemo(() => {
    if (!workOrders || !machines) return {} as Record<string, number>;
    const map: Record<string, number> = {};
    const now = new Date();
    machines.forEach((m) => {
      const zone = m.current_location || m.line || "Unassigned";
      const wos = workOrders.filter((w) => w.machine === m.name);
      wos.forEach((wo) => {
        const mins = differenceInMinutes(now, new Date(wo.created_at));
        map[zone] = (map[zone] || 0) + mins;
      });
    });
    return map;
  }, [workOrders, machines]);

  const statusColors: Record<string, string> = {
    green: "bg-green-500/20 border-green-500 text-green-700",
    yellow: "bg-yellow-500/20 border-yellow-500 text-yellow-700",
    red: "bg-red-500/20 border-red-500 text-red-700 animate-pulse",
    purple: "bg-purple-500/20 border-purple-500 text-purple-700",
  };

  const statusLabels: Record<string, string> = { green: "🟢", yellow: "🟡", red: "🔴", purple: "🟣" };

  const top5 = engineerScores?.slice(0, 5) || [];

  const formatDowntime = (mins: number) => {
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    return `${h}h ${mins % 60}m`;
  };

  const getHealthColor = (score: number) => {
    if (score >= 70) return "text-green-600 bg-green-500/20";
    if (score >= 40) return "text-yellow-600 bg-yellow-500/20";
    return "text-red-600 bg-red-500/20";
  };

  // Drag and drop handlers
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
    const machine = machines.find((m) => m.id === machineId);
    if (!machine) return;
    const currentZone = machine.current_location || machine.line || "Unassigned";
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

  const zoneColors: Record<string, string> = {
    "Storage": "border-blue-300 bg-blue-500/5",
    "Maintenance Area": "border-orange-300 bg-orange-500/5",
  };

  return (
    <DashboardLayout>
      <div className={`space-y-4 ${tvMode ? "p-2" : ""}`}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className={`font-bold flex items-center gap-2 ${tvMode ? "text-lg" : "text-2xl"}`}>
              <Monitor className={tvMode ? "h-4 w-4" : "h-6 w-6"} /> Control Center
            </h2>
            {!tvMode && <p className="text-muted-foreground">Real-time factory map — drag machines between zones</p>}
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

        {/* Predictive Alerts Banner */}
        {predictiveAlerts.length > 0 && (
          <Alert className="border-purple-500 bg-purple-500/10 text-purple-800">
            <AlertTriangle className="h-5 w-5 text-purple-600" />
            <AlertTitle className={tvMode ? "text-xs" : "text-sm font-bold"}>🟣 {predictiveAlerts.length} Predictive Alert(s)</AlertTitle>
            <AlertDescription className={tvMode ? "text-[10px]" : "text-xs"}>
              {predictiveAlerts.slice(0, 3).map((a, i) => (
                <span key={i} className="block">{a.machine}: "{a.problem}" — {a.count}x in 30 days</span>
              ))}
            </AlertDescription>
          </Alert>
        )}

        {/* Legend */}
        <div className={`flex gap-2 flex-wrap ${tvMode ? "text-xs" : ""}`}>
          <Badge variant="outline" className={`bg-green-500/20 border-green-500 text-green-700 ${tvMode ? "text-[10px] px-1.5 py-0" : ""}`}>🟢 Active</Badge>
          <Badge variant="outline" className={`bg-yellow-500/20 border-yellow-500 text-yellow-700 ${tvMode ? "text-[10px] px-1.5 py-0" : ""}`}>🟡 WO Active</Badge>
          <Badge variant="outline" className={`bg-red-500/20 border-red-500 text-red-700 ${tvMode ? "text-[10px] px-1.5 py-0" : ""}`}>🔴 Unattended</Badge>
          <Badge variant="outline" className={`bg-purple-500/20 border-purple-500 text-purple-700 ${tvMode ? "text-[10px] px-1.5 py-0" : ""}`}>🟣 Predictive</Badge>
          <Badge variant="outline" className="text-muted-foreground">
            <GripVertical className="h-3 w-3 mr-1" /> Drag to relocate
          </Badge>
        </div>

        {viewMode === "table" ? (
          /* TABLE MODE */
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
                    {workOrders.map((wo) => {
                      const machine = machines?.find((m) => m.name === wo.machine);
                      const downMin = differenceInMinutes(new Date(), new Date(wo.created_at));
                      return (
                        <TableRow key={wo.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/dashboard/wo/${wo.id}`)}>
                          <TableCell className="font-medium">{machine?.line || "—"}</TableCell>
                          <TableCell>{wo.machine}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={
                              wo.status === "open" ? "bg-red-500/20 border-red-500 text-red-400" :
                              wo.status === "in_progress" ? "bg-amber-500/20 border-amber-500 text-amber-400" :
                              "bg-blue-500/20 border-blue-500 text-blue-400"
                            }>{wo.status}</Badge>
                          </TableCell>
                          <TableCell className="max-w-[200px] truncate">{wo.description}</TableCell>
                          <TableCell>{wo.engineer?.name || "—"}</TableCell>
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
        <div className={`grid gap-4 ${tvMode ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
          {/* Main factory map */}
          <div className={`space-y-3 ${tvMode ? "lg:col-span-4" : "lg:col-span-3"}`}>
            {isLoading ? (
              <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
            ) : !machines?.length ? (
              <p className="text-muted-foreground text-center py-16">No machines registered yet.</p>
            ) : (
              zones.map((zone) => {
                const zoneMachines = machinesByZone[zone] || [];
                const extraClass = zoneColors[zone] || "";
                return (
                  <Card
                    key={zone}
                    className={`transition-all ${extraClass} ${draggedMachine ? "ring-2 ring-primary/30 ring-dashed" : ""} ${tvMode ? "shadow-sm" : ""}`}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, zone)}
                  >
                    <CardHeader className={tvMode ? "pb-1 p-2" : "pb-3"}>
                      <div className="flex items-center justify-between">
                        <CardTitle className={tvMode ? "text-xs font-bold" : "text-base"}>{zone}</CardTitle>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className={tvMode ? "text-[9px] px-1 py-0" : "text-xs"}>
                            {zoneMachines.length} machine{zoneMachines.length !== 1 ? "s" : ""}
                          </Badge>
                          {lineDowntime[zone] > 0 && (
                            <Badge variant="destructive" className={`gap-1 ${tvMode ? "text-[9px] px-1 py-0" : ""}`}>
                              <Clock className={tvMode ? "h-2 w-2" : "h-3 w-3"} /> {formatDowntime(lineDowntime[zone])}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className={tvMode ? "p-2 pt-0" : ""}>
                      <div className={`grid gap-1.5 ${tvMode
                        ? "grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12"
                        : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"}`}>
                        {zoneMachines.map((m) => {
                          const ms = machineStatus[m.name] || { status: "green" as const, woCount: 0 };
                          const hs = m.health_score ?? 100;
                          const latestWO = workOrders?.find((w) => w.machine === m.name);
                          return (
                            <HoverCard key={m.id} openDelay={200} closeDelay={100}>
                              <HoverCardTrigger asChild>
                                <div
                                  draggable
                                  onDragStart={(e) => handleDragStart(e, m.id)}
                                  onDragEnd={() => setDraggedMachine(null)}
                                  onClick={() => navigate(`/dashboard/machines/${encodeURIComponent(m.name)}/history`)}
                                  className={`border rounded-md cursor-grab active:cursor-grabbing transition-all hover:scale-105 ${statusColors[ms.status]} ${tvMode ? "p-1.5 border" : "p-3 border-2"} ${draggedMachine === m.id ? "opacity-50 scale-95" : ""}`}
                                >
                                  <p className={`font-medium truncate ${tvMode ? "text-[10px]" : "text-sm"}`}>{m.name}</p>
                                  {m.code && !tvMode && <p className="text-xs font-mono opacity-70">{m.code}</p>}
                                  <div className="flex items-center justify-between">
                                    <p className={tvMode ? "text-[9px]" : "text-xs mt-1"}>{statusLabels[ms.status]}{!tvMode && ` ${ms.status === "green" ? "Active" : ms.status === "yellow" ? "WO Active" : ms.status === "red" ? "Unattended" : "Predictive"}`}</p>
                                    <span className={`rounded px-1 font-mono font-bold ${getHealthColor(hs)} ${tvMode ? "text-[8px]" : "text-[10px]"}`}>
                                      <Heart className={`inline ${tvMode ? "h-2 w-2" : "h-3 w-3"}`} /> {hs}
                                    </span>
                                  </div>
                                  {ms.woCount > 0 && !tvMode && (
                                    <Badge variant="secondary" className="mt-1 text-xs">{ms.woCount} WO(s)</Badge>
                                  )}
                                </div>
                              </HoverCardTrigger>
                              {!tvMode && (
                                <HoverCardContent className="w-64 text-sm" side="top">
                                  <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                      <span className="font-bold">{m.name}</span>
                                      <Badge variant="outline" className={statusColors[ms.status]}>{ms.status}</Badge>
                                    </div>
                                    {m.code && <p className="text-xs text-muted-foreground font-mono">Code: {m.code}</p>}
                                    <p className="text-xs">Type: {m.machine_type || "—"}</p>
                                    <p className="text-xs">Location: {m.current_location || "—"}</p>
                                    <p className="text-xs">Health: <span className={`font-bold ${getHealthColor(hs)} px-1 rounded`}>{hs}/100</span></p>
                                    {latestWO && (
                                      <div className="border-t pt-1">
                                        <p className="text-xs text-muted-foreground">Latest WO: {latestWO.description?.slice(0, 40)}</p>
                                      </div>
                                    )}
                                  </div>
                                </HoverCardContent>
                              )}
                            </HoverCard>
                          );
                        })}
                      </div>
                      {zoneMachines.length === 0 && (
                        <p className="text-muted-foreground text-xs text-center py-4">Drop machines here</p>
                      )}
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>

          {/* Sidebar: Top 5 + Active WOs */}
          <div className="space-y-3">
            <Card className={tvMode ? "shadow-sm" : ""}>
              <CardHeader className={tvMode ? "pb-1 p-2" : "pb-3"}>
                <CardTitle className={`flex items-center gap-2 ${tvMode ? "text-xs" : "text-base"}`}>
                  <Trophy className={tvMode ? "h-3 w-3 text-yellow-500" : "h-4 w-4 text-yellow-500"} /> Top 5
                </CardTitle>
              </CardHeader>
              <CardContent className={tvMode ? "p-2 pt-0" : ""}>
                {!top5.length ? (
                  <p className="text-muted-foreground text-xs text-center py-2">No scores yet</p>
                ) : (
                  <div className={`space-y-1 ${tvMode ? "" : "space-y-2"}`}>
                    {top5.map((eng, i) => (
                      <div key={eng.id} className={`flex items-center gap-1.5 rounded-lg bg-muted/50 ${tvMode ? "p-1 text-[10px]" : "p-2"}`}>
                        <span className={`font-bold ${tvMode ? "w-4 text-center text-[10px]" : "text-lg w-6 text-center"}`}>{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <p className={`font-medium truncate ${tvMode ? "text-[10px]" : "text-sm"}`}>{eng.engineer_name}</p>
                        </div>
                        <Badge variant={eng.score >= 0 ? "default" : "destructive"} className={tvMode ? "text-[9px] px-1 py-0" : "text-xs"}>
                          {eng.score}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className={tvMode ? "shadow-sm" : ""}>
              <CardHeader className={tvMode ? "pb-1 p-2" : "pb-3"}>
                <CardTitle className={tvMode ? "text-xs" : "text-base"}>Active WOs</CardTitle>
              </CardHeader>
              <CardContent className={tvMode ? "p-2 pt-0" : ""}>
                <div className={`space-y-1 ${tvMode ? "text-[10px]" : "text-sm"}`}>
                  <div className="flex justify-between"><span className="text-muted-foreground">Open</span><span className="font-bold">{workOrders?.filter((w) => w.status === "open").length ?? 0}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Received</span><span className="font-bold">{workOrders?.filter((w) => w.status === "received").length ?? 0}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">In Progress</span><span className="font-bold">{workOrders?.filter((w) => w.status === "in_progress").length ?? 0}</span></div>
                  <div className="flex justify-between pt-1 border-t"><span className="font-medium">Total</span><span className="font-bold text-primary">{workOrders?.length ?? 0}</span></div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
        )}
      </div>
    </DashboardLayout>
  );
}
