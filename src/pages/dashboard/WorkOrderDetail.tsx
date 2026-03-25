import { useParams, useNavigate } from "react-router-dom";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Loader2, Clock, Play, CheckCircle, XCircle, Printer, PenTool, Phone, MapPin, Wrench, Lock, Camera } from "lucide-react";
import { useWorkOrderById } from "@/hooks/useWorkOrders";
import { usePartsUsedByWO } from "@/hooks/useStock";
import { useWOPhotos, getWOPhotoUrl } from "@/hooks/useWOPhotos";
import { format, differenceInMinutes } from "date-fns";

const statusConfig: Record<string, { label: string; className: string }> = {
  open: { label: "Open", className: "bg-blue-100 text-blue-800 border-blue-200" },
  received: { label: "Received", className: "bg-indigo-100 text-indigo-800 border-indigo-200" },
  arrived: { label: "Arrived", className: "bg-purple-100 text-purple-800 border-purple-200" },
  in_progress: { label: "In Progress", className: "bg-amber-100 text-amber-800 border-amber-200" },
  finished: { label: "Finished", className: "bg-teal-100 text-teal-800 border-teal-200" },
  closed: { label: "Closed", className: "bg-green-100 text-green-800 border-green-200" },
  completed: { label: "Completed", className: "bg-green-100 text-green-800 border-green-200" },
  force_closed: { label: "Force Closed", className: "bg-gray-100 text-gray-800 border-gray-200" },
};

const priorityConfig: Record<string, { label: string; className: string }> = {
  low: { label: "Low", className: "bg-slate-100 text-slate-700" },
  medium: { label: "Medium", className: "bg-blue-100 text-blue-700" },
  high: { label: "High", className: "bg-orange-100 text-orange-700" },
  critical: { label: "Critical", className: "bg-red-100 text-red-700" },
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

function formatDuration(minutes: number | null) {
  if (minutes === null) return "—";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}min`;
}

export default function WorkOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: wo, isLoading } = useWorkOrderById(id!);
  const { data: partsUsed, isLoading: partsLoading } = usePartsUsedByWO(id!);
  const { data: woPhotos } = useWOPhotos(id!);

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
  const pri = priorityConfig[wo.priority || "medium"] || priorityConfig.medium;
  const woLabel = `WO-${String(wo.wo_number).padStart(4, "0")}`;

  // Calculated times
  const responseTime = wo.received_at ? differenceInMinutes(new Date(wo.received_at), new Date(wo.created_at)) : null;
  const travelTime = wo.received_at && wo.arrived_at ? differenceInMinutes(new Date(wo.arrived_at), new Date(wo.received_at)) : null;
  const repairTime = wo.started_at && (wo.finished_at || wo.completed_at) ? differenceInMinutes(new Date(wo.finished_at || wo.completed_at!), new Date(wo.started_at)) : null;
  const totalTime = (wo.closed_at || wo.completed_at) ? differenceInMinutes(new Date(wo.closed_at || wo.completed_at!), new Date(wo.created_at)) : null;

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-3xl print-content">
        {/* Print-only header */}
        <div className="hidden print:block mb-6 border-b-2 border-foreground pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img src="/appliedlogo.jpeg" alt="AN" className="h-12 w-12 rounded object-contain" />
              <div>
                <h1 className="text-xl font-bold">AN Maintenance</h1>
                <p className="text-sm text-muted-foreground">Work Order Report</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold font-mono">{woLabel}</p>
              <p className="text-sm text-muted-foreground">{format(new Date(wo.created_at), "dd/MM/yyyy HH:mm:ss")}</p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between print:hidden">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-2">
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()} className="gap-2">
            <Printer className="h-4 w-4" /> Print
          </Button>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">{wo.requester_name} — {wo.machine}</h2>
            <p className="text-muted-foreground text-sm font-mono">{woLabel}</p>
          </div>
          <div className="flex gap-2">
            <Badge variant="outline" className={`text-sm px-3 py-1 ${pri.className}`}>{pri.label}</Badge>
            <Badge variant="outline" className={`text-sm px-3 py-1 ${cfg.className}`}>{cfg.label}</Badge>
          </div>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Problem Description</CardTitle></CardHeader>
          <CardContent><p>{wo.description}</p></CardContent>
        </Card>

        {wo.notes && (
          <Card>
            <CardHeader><CardTitle className="text-base">Observations</CardTitle></CardHeader>
            <CardContent><p>{wo.notes}</p></CardContent>
          </Card>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Requested By</p><p className="font-medium">{wo.requester_name}</p></CardContent></Card>
          <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Operator</p><p className="font-medium">{wo.operator?.name || "—"}</p></CardContent></Card>
          <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Engineer</p><p className="font-medium">{wo.engineer?.name || "—"}</p></CardContent></Card>
          {wo.closer?.name && <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Closed By</p><p className="font-medium">{wo.closer.name}</p></CardContent></Card>}
          {wo.signed_by_name && <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Signed By</p><p className="font-medium flex items-center gap-2"><PenTool className="h-4 w-4" />{wo.signed_by_name}</p></CardContent></Card>}
        </div>

        {/* Calculated Metrics */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Response Time</p><p className="text-xl font-bold">{formatDuration(responseTime)}</p></CardContent></Card>
          <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Travel Time</p><p className="text-xl font-bold">{formatDuration(travelTime)}</p></CardContent></Card>
          <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Repair Time</p><p className="text-xl font-bold">{formatDuration(repairTime)}</p></CardContent></Card>
          <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Total Time</p><p className="text-xl font-bold">{formatDuration(totalTime)}</p></CardContent></Card>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Timeline</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-4">
              <TimelineItem icon={Clock} label="Created" time={wo.created_at} className="bg-blue-100 text-blue-700" />
              <TimelineItem icon={Phone} label="Received" time={wo.received_at} className="bg-indigo-100 text-indigo-700" />
              <TimelineItem icon={MapPin} label="Arrived" time={wo.arrived_at} className="bg-purple-100 text-purple-700" />
              <TimelineItem icon={Play} label="Started" time={wo.started_at} className="bg-amber-100 text-amber-700" />
              <TimelineItem icon={Wrench} label="Finished" time={wo.finished_at} className="bg-teal-100 text-teal-700" />
              {["closed", "completed"].includes(wo.status) && <TimelineItem icon={CheckCircle} label="Closed" time={wo.closed_at || wo.completed_at} className="bg-green-100 text-green-700" />}
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

        {/* Photos */}
        {woPhotos && woPhotos.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Camera className="h-4 w-4" /> Photos</CardTitle></CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2">
                {["before", "after"].map((type) => {
                  const photos = woPhotos.filter((p) => p.photo_type === type);
                  return (
                    <div key={type}>
                      <p className="text-sm font-medium mb-2 capitalize">{type}</p>
                      {photos.length ? (
                        <div className="grid gap-2">
                          {photos.map((p) => (
                            <img
                              key={p.id}
                              src={getWOPhotoUrl(p.storage_path)}
                              alt={`${type} photo`}
                              className="rounded-lg border w-full max-h-64 object-cover"
                            />
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">No {type} photo</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
