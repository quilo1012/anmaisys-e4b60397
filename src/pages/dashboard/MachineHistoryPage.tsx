import { useParams, useNavigate } from "react-router-dom";
import { machineReliability } from "@/lib/machineReliability";
import { DashboardLayout } from "@/components/DashboardLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getWoStatusConfig } from "@/lib/woStatusConfig";

const PRIORITY_BADGE: Record<string, string> = {
  critical: "bg-destructive/15 text-destructive-strong border-destructive/30",
  high: "bg-warning/15 text-warning-strong border-warning/30",
  medium: "bg-warning/15 text-warning-strong border-warning/30",
  low: "bg-muted text-muted-foreground border-border",
};
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Loader2, Wrench, TrendingDown, Heart, MapPin, Clock } from "lucide-react";
import { useWorkOrders } from "@/hooks/useWorkOrders";
import { useMachines, useMachineLocationLog } from "@/hooks/useMachines";
import { useMemo } from "react";
import { format } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";


export default function MachineHistoryPage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const machineName = decodeURIComponent(name || "");
  // A year, not the default 200 most recent orders across the whole factory.
  //
  // Unranged, this page showed a machine's "full history" from whatever fell inside
  // the 200 newest orders — about seven weeks. A machine that had not failed recently
  // showed an empty history and looked healthy for the worst possible reason.
  const woRange = useMemo(() => ({ from: new Date(Date.now() - 365 * 86_400_000), to: new Date() }), []);
  const { data: allWOs, isLoading } = useWorkOrders(woRange);
  const { data: machines } = useMachines();

  const machine = useMemo(() => machines?.find(m => m.name === machineName), [machines, machineName]);
  const { data: locationLog, isLoading: logLoading } = useMachineLocationLog(machine?.id);

  const healthScore = machine?.health_score ?? 100;
  const healthColor = healthScore >= 70 ? "text-success-strong" : healthScore >= 40 ? "text-warning-strong" : "text-destructive-strong";

  const machineWOs = useMemo(
    () => allWOs?.filter((w) => w.machine === machineName).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) ?? [],
    [allWOs, machineName]
  );

  const stats = useMemo(() => machineReliability(machineWOs, new Date()), [machineWOs]);

  const failureChart = useMemo(() => {
    const months: Record<string, number> = {};
    machineWOs.forEach((wo) => {
      const key = format(new Date(wo.created_at), "yyyy-MM");
      months[key] = (months[key] || 0) + 1;
    });
    return Object.entries(months).sort(([a], [b]) => a.localeCompare(b)).slice(-12)
      .map(([month, count]) => ({ month: format(new Date(month + "-01"), "MMM yy"), count }));
  }, [machineWOs]);

  const reliabilityColor = stats.reliability > 80 ? "text-success-strong" : stats.reliability > 50 ? "text-warning-strong" : "text-destructive-strong";

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <PageHeader
            title={machineName}
            description="Machine history, location and reliability"
            icon={<Wrench className="h-5 w-5" />}
          />
        </div>

        {/* Overview cards */}
        <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
          <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Type</p><p className="text-lg font-bold">{machine?.machine_type || "—"}</p></CardContent></Card>
          <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground flex items-center gap-1"><MapPin className="h-3 w-3" /> Location</p><p className="text-lg font-bold">{machine?.current_location || "—"}</p></CardContent></Card>
          <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Status</p><Badge variant={machine?.status === "active" ? "default" : "secondary"}>{machine?.status || "—"}</Badge></CardContent></Card>
          <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Total WOs</p><p className="text-2xl font-bold">{stats.total}</p></CardContent></Card>
          <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Reliability</p><p className={`text-2xl font-bold ${reliabilityColor}`}>{stats.reliability}%</p></CardContent></Card>
          <Card className="border-primary/30"><CardContent className="pt-6"><p className="text-sm text-muted-foreground flex items-center gap-1"><Heart className="h-4 w-4" /> Health</p><p className={`text-2xl font-bold ${healthColor}`}>{healthScore}</p></CardContent></Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="workorders" className="space-y-4">
          <TabsList>
            <TabsTrigger value="workorders">Maintenance Orders</TabsTrigger>
            <TabsTrigger value="locations">Location History</TabsTrigger>
            <TabsTrigger value="failures">Failure Chart</TabsTrigger>
          </TabsList>

          <TabsContent value="workorders">
            <Card>
              <CardHeader><CardTitle className="text-base">Maintenance Order History</CardTitle></CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                ) : !machineWOs.length ? (
                  <p className="text-muted-foreground text-center py-8">No maintenance orders for this machine.</p>
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
                          <TableCell><Badge className={`${getWoStatusConfig(wo.status).className} border`}>{getWoStatusConfig(wo.status).label}</Badge></TableCell>
                          <TableCell><Badge className={`${PRIORITY_BADGE[(wo.priority || "").toLowerCase()] ?? "bg-muted text-muted-foreground border-border"} border capitalize`}>{wo.priority || "—"}</Badge></TableCell>
                          <TableCell className="max-w-[200px] truncate">{wo.description}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{format(new Date(wo.created_at), "dd/MM/yyyy HH:mm")}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="locations">
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><MapPin className="h-4 w-4" /> Location History</CardTitle></CardHeader>
              <CardContent>
                {logLoading ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                ) : !locationLog?.length ? (
                  <p className="text-muted-foreground text-center py-8">No location changes recorded.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>From</TableHead>
                        <TableHead>To</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {locationLog.map((log) => (
                        <TableRow key={log.id}>
                          <TableCell className="text-sm flex items-center gap-1"><Clock className="h-3 w-3 text-muted-foreground" />{format(new Date(log.created_at), "dd/MM/yyyy HH:mm")}</TableCell>
                          <TableCell>{log.from_location || "—"}</TableCell>
                          <TableCell><Badge variant="outline" className="gap-1"><MapPin className="h-3 w-3" />{log.to_location}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="failures">
            {failureChart.length > 0 ? (
              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><TrendingDown className="h-4 w-4" /> Failure Frequency</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={failureChart}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" />
                      <YAxis allowDecimals={false} />
                      <Tooltip contentStyle={{ backgroundColor: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "8px", color: "hsl(var(--popover-foreground))" }} labelStyle={{ color: "hsl(var(--popover-foreground))" }} />
                      <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            ) : (
              <Card><CardContent className="py-8"><p className="text-muted-foreground text-center">No failure data yet.</p></CardContent></Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
