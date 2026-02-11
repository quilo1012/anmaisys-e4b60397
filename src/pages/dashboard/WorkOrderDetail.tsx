import { useParams, useNavigate } from "react-router-dom";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Loader2, Clock, Play, CheckCircle, XCircle } from "lucide-react";
import { useWorkOrderById } from "@/hooks/useWorkOrders";
import { usePartsUsedByWO } from "@/hooks/useStock";
import { format, differenceInMinutes } from "date-fns";

const statusConfig: Record<string, { label: string; className: string }> = {
  open: { label: "Open", className: "bg-blue-100 text-blue-800 border-blue-200" },
  in_progress: { label: "In Progress", className: "bg-amber-100 text-amber-800 border-amber-200" },
  completed: { label: "Completed", className: "bg-green-100 text-green-800 border-green-200" },
  force_closed: { label: "Force Closed", className: "bg-gray-100 text-gray-800 border-gray-200" },
};

function TimelineItem({ icon: Icon, label, time, className }: { icon: React.ComponentType<{ className?: string }>; label: string; time: string | null; className?: string }) {
  if (!time) return null;
  return (
    <div className="flex items-start gap-3">
      <div className={`rounded-full p-1.5 ${className || "bg-muted"}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <p className="font-medium text-sm">{label}</p>
        <p className="text-xs text-muted-foreground">{format(new Date(time), "dd/MM/yyyy HH:mm:ss")}</p>
      </div>
    </div>
  );
}

export default function WorkOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: wo, isLoading } = useWorkOrderById(id!);
  const { data: partsUsed, isLoading: partsLoading } = usePartsUsedByWO(id!);

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      </DashboardLayout>
    );
  }

  if (!wo) {
    return (
      <DashboardLayout>
        <div className="text-center py-16">
          <p className="text-muted-foreground">Work order not found.</p>
          <Button variant="link" onClick={() => navigate(-1)}>Go back</Button>
        </div>
      </DashboardLayout>
    );
  }

  const cfg = statusConfig[wo.status];
  const responseTime = wo.started_at ? differenceInMinutes(new Date(wo.started_at), new Date(wo.created_at)) : null;
  const totalTime = wo.completed_at ? differenceInMinutes(new Date(wo.completed_at), new Date(wo.created_at)) : null;

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-3xl">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>

        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">{wo.line} — {wo.machine}</h2>
            <p className="text-muted-foreground text-sm">WO #{wo.id.slice(0, 8)}</p>
          </div>
          <Badge variant="outline" className={`text-sm px-3 py-1 ${cfg.className}`}>{cfg.label}</Badge>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Problem Description</CardTitle></CardHeader>
          <CardContent><p>{wo.description}</p></CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-3">
          <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Operator</p><p className="font-medium">{wo.operator?.name || "—"}</p></CardContent></Card>
          <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Engineer</p><p className="font-medium">{wo.engineer?.name || "—"}</p></CardContent></Card>
          {wo.closer?.name && <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Closed By</p><p className="font-medium">{wo.closer.name}</p></CardContent></Card>}
        </div>

        {(responseTime !== null || totalTime !== null) && (
          <div className="grid gap-4 md:grid-cols-2">
            {responseTime !== null && <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Response Time</p><p className="text-xl font-bold">{responseTime} min</p></CardContent></Card>}
            {totalTime !== null && <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Total Time</p><p className="text-xl font-bold">{totalTime} min</p></CardContent></Card>}
          </div>
        )}

        <Card>
          <CardHeader><CardTitle className="text-base">Timeline</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-4">
              <TimelineItem icon={Clock} label="Created" time={wo.created_at} className="bg-blue-100 text-blue-700" />
              <TimelineItem icon={Play} label="Started" time={wo.started_at} className="bg-amber-100 text-amber-700" />
              {wo.status === "completed" && <TimelineItem icon={CheckCircle} label="Completed" time={wo.completed_at} className="bg-green-100 text-green-700" />}
              {wo.status === "force_closed" && <TimelineItem icon={XCircle} label="Force Closed" time={wo.completed_at} className="bg-gray-100 text-gray-700" />}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Parts Used</CardTitle></CardHeader>
          <CardContent>
            {partsLoading ? (
              <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : !partsUsed?.length ? (
              <p className="text-muted-foreground text-sm">No parts registered for this work order.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>Engineer</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {partsUsed.map((pu) => (
                    <TableRow key={pu.id}>
                      <TableCell className="font-medium">{pu.product?.name || "—"}</TableCell>
                      <TableCell>{pu.product?.code || "—"}</TableCell>
                      <TableCell>{pu.quantity}</TableCell>
                      <TableCell>{pu.engineer?.name || "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{format(new Date(pu.created_at), "dd/MM HH:mm")}</TableCell>
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
