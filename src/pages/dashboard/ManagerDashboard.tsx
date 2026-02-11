import { useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LayoutDashboard, ClipboardList, Users, Package, XCircle, Loader2 } from "lucide-react";
import { useWorkOrders, useForceCloseWorkOrder, type WOStatus } from "@/hooks/useWorkOrders";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";

const statusConfig: Record<string, { label: string; className: string }> = {
  open: { label: "Open", className: "bg-blue-100 text-blue-800 border-blue-200" },
  in_progress: { label: "In Progress", className: "bg-amber-100 text-amber-800 border-amber-200" },
  completed: { label: "Completed", className: "bg-green-100 text-green-800 border-green-200" },
  force_closed: { label: "Force Closed", className: "bg-gray-100 text-gray-800 border-gray-200" },
};

export default function ManagerDashboard() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const filterStatuses = statusFilter === "all" ? undefined : [statusFilter as WOStatus];
  const { data: workOrders, isLoading } = useWorkOrders({ statusIn: filterStatuses });
  const { data: allWOs } = useWorkOrders();
  const forceClose = useForceCloseWorkOrder();
  const navigate = useNavigate();

  const { data: userCount } = useQuery({
    queryKey: ["user_count"],
    queryFn: async () => {
      const { count, error } = await supabase.from("profiles").select("*", { count: "exact", head: true });
      if (error) throw error;
      return count ?? 0;
    },
  });

  const today = new Date().toDateString();
  const openCount = allWOs?.filter((w) => w.status === "open").length ?? 0;
  const inProgressCount = allWOs?.filter((w) => w.status === "in_progress").length ?? 0;
  const completedToday = allWOs?.filter((w) => w.status === "completed" && w.completed_at && new Date(w.completed_at).toDateString() === today).length ?? 0;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold">Manager Dashboard</h2>
          <p className="text-muted-foreground">Full system overview and control</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Open WOs</CardTitle>
              <ClipboardList className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><div className="text-2xl font-bold">{openCount}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">In Progress</CardTitle>
              <LayoutDashboard className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><div className="text-2xl font-bold">{inProgressCount}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Completed Today</CardTitle>
              <ClipboardList className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><div className="text-2xl font-bold">{completedToday}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Users</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><div className="text-2xl font-bold">{userCount ?? "—"}</div></CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <ClipboardList className="h-5 w-5" /> All Work Orders
              </CardTitle>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="Filter status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="force_closed">Force Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : !workOrders?.length ? (
              <p className="text-muted-foreground text-center py-8">No work orders found.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Line</TableHead>
                    <TableHead>Machine</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Operator</TableHead>
                    <TableHead>Engineer</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {workOrders.map((wo) => {
                    const cfg = statusConfig[wo.status];
                    const canForceClose = wo.status === "open" || wo.status === "in_progress";
                    return (
                      <TableRow key={wo.id}>
                        <TableCell className="font-medium cursor-pointer hover:underline" onClick={() => navigate(`/dashboard/wo/${wo.id}`)}>{wo.line}</TableCell>
                        <TableCell>{wo.machine}</TableCell>
                        <TableCell><Badge variant="outline" className={cfg.className}>{cfg.label}</Badge></TableCell>
                        <TableCell className="text-sm">{wo.operator?.name || "—"}</TableCell>
                        <TableCell className="text-sm">{wo.engineer?.name || "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{format(new Date(wo.created_at), "dd/MM HH:mm")}</TableCell>
                        <TableCell>
                          {canForceClose && (
                            <Button size="sm" variant="destructive" onClick={() => forceClose.mutate(wo.id)} disabled={forceClose.isPending}>
                              <XCircle className="h-3 w-3 mr-1" /> Force Close
                            </Button>
                          )}
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
    </DashboardLayout>
  );
}
