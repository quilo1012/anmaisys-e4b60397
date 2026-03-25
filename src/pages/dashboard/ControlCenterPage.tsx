import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useMachines } from "@/hooks/useMachines";
import { useWorkOrders } from "@/hooks/useWorkOrders";
import { Monitor, Loader2 } from "lucide-react";

export default function ControlCenterPage() {
  const { data: machines, isLoading: machinesLoading } = useMachines();
  const { data: workOrders, isLoading: wosLoading } = useWorkOrders({ statusIn: ["open", "received", "arrived", "in_progress"] as any });
  const navigate = useNavigate();

  const isLoading = machinesLoading || wosLoading;

  // Group machines by line
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

  // Map machine name to worst WO status
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

  const statusColors = {
    green: "bg-green-500/20 border-green-500 text-green-700",
    yellow: "bg-yellow-500/20 border-yellow-500 text-yellow-700",
    red: "bg-red-500/20 border-red-500 text-red-700 animate-pulse",
  };

  const statusLabels = { green: "🟢 Running", yellow: "🟡 WO Active", red: "🔴 Unattended" };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2"><Monitor className="h-6 w-6" /> Control Center</h2>
          <p className="text-muted-foreground">Real-time factory machine status</p>
        </div>

        {/* Legend */}
        <div className="flex gap-4 flex-wrap">
          <Badge variant="outline" className="bg-green-500/20 border-green-500 text-green-700">🟢 Running</Badge>
          <Badge variant="outline" className="bg-yellow-500/20 border-yellow-500 text-yellow-700">🟡 WO Active</Badge>
          <Badge variant="outline" className="bg-red-500/20 border-red-500 text-red-700">🔴 Unattended</Badge>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
        ) : !machines?.length ? (
          <p className="text-muted-foreground text-center py-16">No machines registered yet.</p>
        ) : (
          Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([line, lineMachines]) => (
            <Card key={line}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{line}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                  {lineMachines.map((m) => {
                    const ms = machineStatus[m.name] || { status: "green" as const, woCount: 0 };
                    return (
                      <div
                        key={m.id}
                        onClick={() => navigate(`/dashboard/machines/${encodeURIComponent(m.name)}/history`)}
                        className={`border-2 rounded-lg p-3 cursor-pointer transition-all hover:scale-105 ${statusColors[ms.status]}`}
                      >
                        <p className="font-medium text-sm truncate">{m.name}</p>
                        {m.code && <p className="text-xs font-mono opacity-70">{m.code}</p>}
                        <p className="text-xs mt-1">{statusLabels[ms.status]}</p>
                        {ms.woCount > 0 && (
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
    </DashboardLayout>
  );
}
