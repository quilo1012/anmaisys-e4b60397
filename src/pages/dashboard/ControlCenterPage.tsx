import { useMemo, useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useMachines } from "@/hooks/useMachines";
import { useWorkOrders } from "@/hooks/useWorkOrders";
import { useEngineerScores } from "@/hooks/useEngineerScores";
import { Monitor, Loader2, Maximize, Minimize, Trophy, Clock } from "lucide-react";
import { differenceInMinutes } from "date-fns";

export default function ControlCenterPage() {
  const { data: machines, isLoading: machinesLoading } = useMachines();
  const { data: workOrders, isLoading: wosLoading } = useWorkOrders({ statusIn: ["open", "received", "arrived", "in_progress"] as any });
  const { data: engineerScores } = useEngineerScores();
  const navigate = useNavigate();
  const [isFullscreen, setIsFullscreen] = useState(false);

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

  const grouped = useMemo(() => {
    if (!machines) return {};
    const groups: Record<string, typeof machines> = {};
    machines.forEach((m) => {
      const line = m.line || "Unassigned";
      if (!groups[line]) groups[line] = [];
      groups[line].push(m);
    });
    return groups;
  }, [machines]);

  const machineStatus = useMemo(() => {
    const map: Record<string, { status: "green" | "yellow" | "red"; woCount: number }> = {};
    if (!machines || !workOrders) return map;
    machines.forEach((m) => {
      const wos = workOrders.filter((w) => w.machine === m.name);
      if (!wos.length) {
        map[m.name] = { status: "green", woCount: 0 };
      } else {
        const hasOpen = wos.some((w) => w.status === "open");
        map[m.name] = { status: hasOpen ? "red" : "yellow", woCount: wos.length };
      }
    });
    return map;
  }, [machines, workOrders]);

  const lineDowntime = useMemo(() => {
    if (!workOrders || !machines) return {} as Record<string, number>;
    const map: Record<string, number> = {};
    const now = new Date();
    const machineLineMap: Record<string, string> = {};
    machines.forEach((m) => { machineLineMap[m.name] = m.line || "Unassigned"; });
    workOrders.forEach((wo) => {
      const line = machineLineMap[wo.machine] || "Unassigned";
      const mins = differenceInMinutes(now, new Date(wo.created_at));
      map[line] = (map[line] || 0) + mins;
    });
    return map;
  }, [workOrders, machines]);

  const statusColors = {
    green: "bg-green-500/20 border-green-500 text-green-700",
    yellow: "bg-yellow-500/20 border-yellow-500 text-yellow-700",
    red: "bg-red-500/20 border-red-500 text-red-700 animate-pulse",
  };

  const statusLabels = { green: "🟢", yellow: "🟡", red: "🔴" };

  const top5 = engineerScores?.slice(0, 5) || [];

  const formatDowntime = (mins: number) => {
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    return `${h}h ${mins % 60}m`;
  };

  // TV mode uses compact styling
  const tvMode = isFullscreen;

  return (
    <DashboardLayout>
      <div className={`space-y-4 ${tvMode ? "p-2" : ""}`}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className={`font-bold flex items-center gap-2 ${tvMode ? "text-lg" : "text-2xl"}`}>
              <Monitor className={tvMode ? "h-4 w-4" : "h-6 w-6"} /> Control Center
            </h2>
            {!tvMode && <p className="text-muted-foreground">Real-time factory machine status</p>}
          </div>
          <Button variant="outline" size="sm" onClick={toggleFullscreen} className="gap-2">
            {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
            {isFullscreen ? "Exit" : "TV Mode"}
          </Button>
        </div>

        {/* Legend - compact in TV mode */}
        <div className={`flex gap-2 flex-wrap ${tvMode ? "text-xs" : ""}`}>
          <Badge variant="outline" className={`bg-green-500/20 border-green-500 text-green-700 ${tvMode ? "text-[10px] px-1.5 py-0" : ""}`}>🟢 Running</Badge>
          <Badge variant="outline" className={`bg-yellow-500/20 border-yellow-500 text-yellow-700 ${tvMode ? "text-[10px] px-1.5 py-0" : ""}`}>🟡 WO Active</Badge>
          <Badge variant="outline" className={`bg-red-500/20 border-red-500 text-red-700 ${tvMode ? "text-[10px] px-1.5 py-0" : ""}`}>🔴 Unattended</Badge>
        </div>

        <div className={`grid gap-4 ${tvMode ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
          {/* Main machine grid */}
          <div className={`space-y-3 ${tvMode ? "lg:col-span-4" : "lg:col-span-3"}`}>
            {isLoading ? (
              <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
            ) : !machines?.length ? (
              <p className="text-muted-foreground text-center py-16">No machines registered yet.</p>
            ) : (
              Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([line, lineMachines]) => (
                <Card key={line} className={tvMode ? "shadow-sm" : ""}>
                  <CardHeader className={tvMode ? "pb-1 p-2" : "pb-3"}>
                    <div className="flex items-center justify-between">
                      <CardTitle className={tvMode ? "text-xs font-bold" : "text-base"}>{line}</CardTitle>
                      {lineDowntime[line] > 0 && (
                        <Badge variant="destructive" className={`gap-1 ${tvMode ? "text-[9px] px-1 py-0" : ""}`}>
                          <Clock className={tvMode ? "h-2 w-2" : "h-3 w-3"} /> {formatDowntime(lineDowntime[line])}
                        </Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className={tvMode ? "p-2 pt-0" : ""}>
                    <div className={`grid gap-1.5 ${tvMode 
                      ? "grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12" 
                      : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"}`}>
                      {lineMachines.map((m) => {
                        const ms = machineStatus[m.name] || { status: "green" as const, woCount: 0 };
                        return (
                          <div
                            key={m.id}
                            onClick={() => navigate(`/dashboard/machines/${encodeURIComponent(m.name)}/history`)}
                            className={`border rounded-md cursor-pointer transition-all hover:scale-105 ${statusColors[ms.status]} ${tvMode ? "p-1.5 border" : "p-3 border-2"}`}
                          >
                            <p className={`font-medium truncate ${tvMode ? "text-[10px]" : "text-sm"}`}>{m.name}</p>
                            {m.code && !tvMode && <p className="text-xs font-mono opacity-70">{m.code}</p>}
                            <p className={tvMode ? "text-[9px]" : "text-xs mt-1"}>{statusLabels[ms.status]} {!tvMode && (ms.status === "green" ? "Running" : ms.status === "yellow" ? "WO Active" : "Unattended")}</p>
                            {ms.woCount > 0 && !tvMode && (
                              <Badge variant="secondary" className="mt-1 text-xs">{ms.woCount} WO(s)</Badge>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              ))
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
      </div>
    </DashboardLayout>
  );
}