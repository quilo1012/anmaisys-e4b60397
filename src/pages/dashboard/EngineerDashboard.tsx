import { useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Wrench, Play, CheckCircle, Loader2, Clock, BarChart3, Package, Activity, Timer } from "lucide-react";
import { useWorkOrders, useStartWorkOrder, useCompleteWorkOrder } from "@/hooks/useWorkOrders";
import { useWOAlerts } from "@/hooks/useWOAlerts";
import { useTotalPartsUsedByEngineer } from "@/hooks/useStock";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { format, differenceInMinutes } from "date-fns";
import { useMemo } from "react";
import { PartsUsedDialog } from "@/components/PartsUsedDialog";

const statusConfig: Record<string, { label: string; className: string }> = {
  open: { label: "Open", className: "bg-blue-100 text-blue-800 border-blue-200" },
  in_progress: { label: "In Progress", className: "bg-amber-100 text-amber-800 border-amber-200" },
  completed: { label: "Completed", className: "bg-green-100 text-green-800 border-green-200" },
  force_closed: { label: "Force Closed", className: "bg-gray-100 text-gray-800 border-gray-200" },
};

export default function EngineerDashboard() {
  const { user } = useAuth();
  const { data: workOrders, isLoading } = useWorkOrders({ statusIn: ["open", "in_progress"] });
  const { data: allCompleted } = useWorkOrders({ statusIn: ["completed"] });
  const startWO = useStartWorkOrder();
  const completeWO = useCompleteWorkOrder();
  const navigate = useNavigate();
  const { data: totalParts } = useTotalPartsUsedByEngineer(user?.id);
  useWOAlerts();

  const [partsDialogWO, setPartsDialogWO] = useState<string | null>(null);

  const kpis = useMemo(() => {
    if (!allCompleted || !user) return { totalCompleted: 0, avgResponse: 0, avgMTTR: 0 };
    const myCompleted = allCompleted.filter((w) => w.engineer_id === user.id);
    const totalCompleted = myCompleted.length;

    let totalResponse = 0, responseCount = 0, totalMTTR = 0, mttrCount = 0;
    myCompleted.forEach((wo) => {
      if (wo.started_at) {
        totalResponse += differenceInMinutes(new Date(wo.started_at), new Date(wo.created_at));
        responseCount++;
        if (wo.completed_at) {
          totalMTTR += differenceInMinutes(new Date(wo.completed_at), new Date(wo.started_at));
          mttrCount++;
        }
      }
    });

    return {
      totalCompleted,
      avgResponse: responseCount ? Math.round(totalResponse / responseCount) : 0,
      avgMTTR: mttrCount ? Math.round(totalMTTR / mttrCount) : 0,
    };
  }, [allCompleted, user]);

  const activeWOs = workOrders?.filter(
    (wo) => wo.status === "open" || (wo.status === "in_progress" && wo.engineer_id === user?.id)
  );

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold">Engineer Panel</h2>
          <p className="text-muted-foreground">View and execute work orders</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Completed</CardTitle>
              <CheckCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><div className="text-2xl font-bold">{kpis.totalCompleted}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Avg Response</CardTitle>
              <Timer className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><div className="text-2xl font-bold">{kpis.avgResponse} min</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Avg MTTR</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><div className="text-2xl font-bold">{kpis.avgMTTR} min</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Parts Used</CardTitle>
              <Package className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><div className="text-2xl font-bold">{totalParts ?? 0}</div></CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wrench className="h-5 w-5" />
              Work Orders
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : !activeWOs?.length ? (
              <p className="text-muted-foreground text-center py-8">No open work orders right now.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Line</TableHead>
                    <TableHead>Machine</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeWOs.map((wo) => {
                    const cfg = statusConfig[wo.status];
                    return (
                      <TableRow key={wo.id}>
                        <TableCell className="font-medium cursor-pointer hover:underline" onClick={() => navigate(`/dashboard/wo/${wo.id}`)}>{wo.line}</TableCell>
                        <TableCell>{wo.machine}</TableCell>
                        <TableCell className="max-w-[200px] truncate">{wo.description}</TableCell>
                        <TableCell><Badge variant="outline" className={cfg.className}>{cfg.label}</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground">{format(new Date(wo.created_at), "dd/MM HH:mm")}</TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            {wo.status === "open" && (
                              <Button size="sm" onClick={() => startWO.mutate(wo.id)} disabled={startWO.isPending}>
                                <Play className="h-3 w-3 mr-1" /> Start
                              </Button>
                            )}
                            {wo.status === "in_progress" && wo.engineer_id === user?.id && (
                              <>
                                <Button size="sm" variant="outline" onClick={() => setPartsDialogWO(wo.id)}>
                                  <Package className="h-3 w-3 mr-1" /> Parts
                                </Button>
                                <Button size="sm" variant="secondary" onClick={() => completeWO.mutate(wo.id)} disabled={completeWO.isPending}>
                                  <CheckCircle className="h-3 w-3 mr-1" /> Complete
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {partsDialogWO && (
        <PartsUsedDialog open={!!partsDialogWO} onOpenChange={(o) => !o && setPartsDialogWO(null)} workOrderId={partsDialogWO} />
      )}
    </DashboardLayout>
  );
}
