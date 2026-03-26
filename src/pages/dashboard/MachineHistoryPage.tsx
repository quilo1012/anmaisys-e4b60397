import { useParams, useNavigate } from "react-router-dom";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Loader2, Activity, Clock, Wrench, TrendingDown, Heart } from "lucide-react";
import { useWorkOrders } from "@/hooks/useWorkOrders";
import { useMachines } from "@/hooks/useMachines";
import { useMemo } from "react";
import { format, differenceInMinutes } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

const DONE_STATUSES = ["completed", "closed", "finished"];

export default function MachineHistoryPage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const machineName = decodeURIComponent(name || "");
  const { data: allWOs, isLoading } = useWorkOrders();
  const { data: machines } = useMachines();
  
  const machine = useMemo(() => machines?.find(m => m.name === machineName), [machines, machineName]);
  const healthScore = machine?.health_score ?? 100;
  const healthColor = healthScore >= 70 ? "text-green-600" : healthScore >= 40 ? "text-yellow-600" : "text-red-600";

  const machineWOs = useMemo(
    () => allWOs?.filter((w) => w.machine === machineName).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) ?? [],
    [allWOs, machineName]
  );

  const stats = useMemo(() => {
    const done = machineWOs.filter((w) => DONE_STATUSES.includes(w.status));
    let totalDowntime = 0;
    done.forEach((wo) => {
      if (wo.started_at && (wo.finished_at || wo.completed_at)) {
        totalDowntime += differenceInMinutes(new Date(wo.finished_at || wo.completed_at!), new Date(wo.started_at));
      }
    });

    // Reliability: 100 - (downtime / total period * 100)
    const firstWO = machineWOs[machineWOs.length - 1];
    const totalPeriodMinutes = firstWO
      ? differenceInMinutes(new Date(), new Date(firstWO.created_at))
      : 1;
    const reliability = Math.max(0, Math.round(100 - (totalDowntime / Math.max(totalPeriodMinutes, 1)) * 100));

    return { total: machineWOs.length, completed: done.length, totalDowntime, reliability };
  }, [machineWOs]);

  // Failures per month
  const failureChart = useMemo(() => {
    const months: Record<string, number> = {};
    machineWOs.forEach((wo) => {
      const key = format(new Date(wo.created_at), "yyyy-MM");
      months[key] = (months[key] || 0) + 1;
    });
    return Object.entries(months)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([month, count]) => ({ month: format(new Date(month + "-01"), "MMM yy"), count }));
  }, [machineWOs]);

  const reliabilityColor = stats.reliability > 80 ? "text-green-600" : stats.reliability > 50 ? "text-yellow-600" : "text-red-600";
  const reliabilityLabel = stats.reliability > 80 ? "🟢 Stable" : stats.reliability > 50 ? "🟡 Attention" : "🔴 Critical";

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard/machines")} className="gap-2">
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2"><Wrench className="h-6 w-6" /> {machineName}</h2>
            <p className="text-muted-foreground">Machine history & reliability</p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-5">
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Total WOs</p>
              <p className="text-2xl font-bold">{stats.total}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Completed</p>
              <p className="text-2xl font-bold">{stats.completed}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Total Downtime</p>
              <p className="text-2xl font-bold">{stats.totalDowntime < 60 ? `${stats.totalDowntime}min` : `${Math.floor(stats.totalDowntime / 60)}h ${stats.totalDowntime % 60}m`}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Reliability Score</p>
              <p className={`text-2xl font-bold ${reliabilityColor}`}>{stats.reliability}%</p>
              <p className="text-xs mt-1">{reliabilityLabel}</p>
            </CardContent>
          </Card>
          <Card className="border-primary/30">
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground flex items-center gap-1"><Heart className="h-4 w-4" /> Health Score</p>
              <p className={`text-2xl font-bold ${healthColor}`}>{healthScore}</p>
              <p className="text-xs mt-1">{healthScore >= 70 ? "🟢 Healthy" : healthScore >= 40 ? "🟡 Warning" : "🔴 Critical"}</p>
            </CardContent>
          </Card>
        </div>

        {failureChart.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><TrendingDown className="h-4 w-4" /> Failure Frequency</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={failureChart}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle className="text-base">Work Order History</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : !machineWOs.length ? (
              <p className="text-muted-foreground text-center py-8">No work orders for this machine.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>WO#</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {machineWOs.map((wo) => (
                    <TableRow key={wo.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/dashboard/wo/${wo.id}`)}>
                      <TableCell className="font-mono">WO-{new Date(wo.created_at).getFullYear()}-{String(wo.wo_number).padStart(6, "0")}</TableCell>
                      <TableCell><Badge variant="outline">{wo.status}</Badge></TableCell>
                      <TableCell><Badge variant="outline">{wo.priority}</Badge></TableCell>
                      <TableCell className="max-w-[200px] truncate">{wo.description}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{format(new Date(wo.created_at), "dd/MM/yyyy HH:mm")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
