import { useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ClipboardList, Plus, Loader2 } from "lucide-react";
import { useWorkOrders, useCreateWorkOrder } from "@/hooks/useWorkOrders";
import { usePartsCountByWOs } from "@/hooks/useStock";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";

const statusConfig: Record<string, { label: string; className: string }> = {
  open: { label: "Open", className: "bg-blue-100 text-blue-800 border-blue-200" },
  in_progress: { label: "In Progress", className: "bg-amber-100 text-amber-800 border-amber-200" },
  completed: { label: "Completed", className: "bg-green-100 text-green-800 border-green-200" },
  force_closed: { label: "Force Closed", className: "bg-gray-100 text-gray-800 border-gray-200" },
};

export default function OperatorDashboard() {
  const [line, setLine] = useState("");
  const [machine, setMachine] = useState("");
  const [description, setDescription] = useState("");
  const { data: workOrders, isLoading } = useWorkOrders({ operatorOnly: true });
  const createWO = useCreateWorkOrder();
  const { toast } = useToast();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!line.trim() || !machine.trim() || !description.trim()) {
      toast({ title: "Error", description: "All fields are required", variant: "destructive" });
      return;
    }
    try {
      await createWO.mutateAsync({ line: line.trim(), machine: machine.trim(), description: description.trim() });
      toast({ title: "Work Order Created", description: "Your WO has been submitted." });
      setLine("");
      setMachine("");
      setDescription("");
    } catch {
      toast({ title: "Error", description: "Failed to create work order", variant: "destructive" });
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold">Operator Panel</h2>
          <p className="text-muted-foreground">Create and track your work orders</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5" />
              Create Work Order
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="line">Production Line</Label>
                <Input id="line" placeholder="e.g. Line A1" value={line} onChange={(e) => setLine(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="machine">Machine</Label>
                <Input id="machine" placeholder="e.g. Press #3" value={machine} onChange={(e) => setMachine(e.target.value)} />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="desc">Problem Description</Label>
                <Textarea id="desc" placeholder="Describe the issue..." value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
              </div>
              <div className="md:col-span-2">
                <Button type="submit" disabled={createWO.isPending}>
                  {createWO.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  Submit Work Order
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5" />
              My Work Orders
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : !workOrders?.length ? (
              <p className="text-muted-foreground text-center py-8">No work orders yet. Create one above!</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                     <TableHead>WO#</TableHead>
                     <TableHead>Line</TableHead>
                     <TableHead>Machine</TableHead>
                     <TableHead>Status</TableHead>
                     <TableHead>Created</TableHead>
                     <TableHead>Started</TableHead>
                     <TableHead>Completed</TableHead>
                     <TableHead>Engineer</TableHead>
                   </TableRow>
                 </TableHeader>
                 <TableBody>
                   {workOrders.map((wo) => {
                     const cfg = statusConfig[wo.status] || statusConfig.open;
                     return (
                       <TableRow key={wo.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/dashboard/wo/${wo.id}`)}>
                         <TableCell className="font-mono font-medium">WO-{String(wo.wo_number).padStart(4, "0")}</TableCell>
                         <TableCell className="font-medium">{wo.line}</TableCell>
                         <TableCell>{wo.machine}</TableCell>
                         <TableCell><Badge variant="outline" className={cfg.className}>{cfg.label}</Badge></TableCell>
                         <TableCell className="text-sm text-muted-foreground">{format(new Date(wo.created_at), "dd/MM HH:mm")}</TableCell>
                         <TableCell className="text-sm text-muted-foreground">{wo.started_at ? format(new Date(wo.started_at), "dd/MM HH:mm") : "—"}</TableCell>
                         <TableCell className="text-sm text-muted-foreground">{wo.completed_at ? format(new Date(wo.completed_at), "dd/MM HH:mm") : "—"}</TableCell>
                        <TableCell className="text-sm">{wo.engineer?.name || "—"}</TableCell>
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
