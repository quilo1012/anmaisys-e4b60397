import { useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Loader2, Clock, Play, CheckCircle, XCircle, Printer, PenTool, Phone, MapPin, Wrench, Lock, Camera, DollarSign } from "lucide-react";
import { useWorkOrderById } from "@/hooks/useWorkOrders";
import { usePartsUsedByWO } from "@/hooks/useStock";
import { useWOPhotos, getWOPhotoUrl } from "@/hooks/useWOPhotos";
import { WOChat } from "@/components/WOChat";
import { format, differenceInMinutes } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

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
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const { data: wo, isLoading } = useWorkOrderById(id!);
  const { data: partsUsed, isLoading: partsLoading } = usePartsUsedByWO(id!);
  const { data: woPhotos } = useWOPhotos(id!);

  // Fetch parts with prices for cost calculation (admin only)
  const { data: partsWithPrice } = useQuery({
    queryKey: ["parts_used_price", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("parts_used")
        .select("*, product:products(name, code, price)")
        .eq("work_order_id", id!);
      if (error) throw error;
      return data as any[];
    },
    enabled: !!id && isAdmin,
  });

  // Fetch engineer labor rate (admin only)
  const { data: engineerProfile } = useQuery({
    queryKey: ["engineer_rate", wo?.engineer_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("labor_rate")
        .eq("id", wo!.engineer_id!)
        .single();
      if (error) throw error;
      return data as { labor_rate: number };
    },
    enabled: !!wo?.engineer_id && isAdmin,
  });

  const costBreakdown = useMemo(() => {
    if (!wo || !isAdmin) return null;
    const partsCost = (partsWithPrice || []).reduce((sum, p) => sum + (p.product?.price || 0) * p.quantity, 0);
    const repairMinutes = wo.started_at && wo.finished_at ? differenceInMinutes(new Date(wo.finished_at), new Date(wo.started_at)) : 0;
    const repairHours = repairMinutes / 60;
    const rate = engineerProfile?.labor_rate || 0;
    const laborCost = repairHours * rate;
    const overtimeHours = Math.max(0, repairHours - 8);
    const overtimeCost = overtimeHours * rate * 0.5;
    const totalCost = partsCost + laborCost + overtimeCost;
    return { partsCost, laborCost, overtimeCost, totalCost, repairHours: Math.round(repairHours * 10) / 10 };
  }, [wo, partsWithPrice, engineerProfile, isAdmin]);

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
  const woLabel = `WO-${new Date(wo.created_at).getFullYear()}-${String(wo.wo_number).padStart(6, "0")}`;

  // Calculated times
  const responseTime = wo.received_at ? differenceInMinutes(new Date(wo.received_at), new Date(wo.created_at)) : null;
  const travelTime = wo.received_at && wo.arrived_at ? differenceInMinutes(new Date(wo.arrived_at), new Date(wo.received_at)) : null;
  const repairTime = wo.started_at && (wo.finished_at || wo.completed_at) ? differenceInMinutes(new Date(wo.finished_at || wo.completed_at!), new Date(wo.started_at)) : null;
  const totalTime = (wo.closed_at || wo.completed_at) ? differenceInMinutes(new Date(wo.closed_at || wo.completed_at!), new Date(wo.created_at)) : null;

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-3xl print-content" id="wo-print-content">
        {/* Print-only compact header */}
        <div className="hidden print:block mb-2 border-b border-foreground pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <img src="/appliedlogo.jpeg" alt="AN" className="h-8 w-8 rounded object-contain" />
              <span className="text-sm font-bold">AN Maintenance</span>
            </div>
            <span className="text-lg font-bold font-mono">{woLabel}</span>
            <span className="text-xs">{format(new Date(wo.created_at), "dd/MM/yyyy HH:mm")}</span>
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
            <h2 className="text-2xl print:text-base font-bold">{wo.requester_name} — {wo.machine}</h2>
            <p className="text-muted-foreground text-sm font-mono print:hidden">{woLabel}</p>
          </div>
          <div className="flex gap-2">
            <Badge variant="outline" className={`text-sm px-3 py-1 print:text-xs print:px-1 print:py-0 ${pri.className}`}>{pri.label}</Badge>
            <Badge variant="outline" className={`text-sm px-3 py-1 print:text-xs print:px-1 print:py-0 ${cfg.className}`}>{cfg.label}</Badge>
          </div>
        </div>

        {/* Problem + Notes combined for print density */}
        <Card className="print:border-0 print:shadow-none">
          <CardHeader className="print:pb-1 print:pt-2"><CardTitle className="text-base print:text-sm">Problem Description</CardTitle></CardHeader>
          <CardContent className="print:pb-2">
            <p className="print:text-xs">{wo.description}</p>
            {wo.notes && (
              <div className="mt-2 pt-2 border-t print:mt-1 print:pt-1">
                <p className="text-sm font-medium print:text-xs">Observations:</p>
                <p className="print:text-xs">{wo.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Notes card - screen only (combined in print above) */}
        {wo.notes && (
          <Card className="print:hidden">
            <CardHeader><CardTitle className="text-base">Observations</CardTitle></CardHeader>
            <CardContent><p>{wo.notes}</p></CardContent>
          </Card>
        )}

        {/* Personnel - compact 2-col grid for print */}
        <div className="grid gap-4 md:grid-cols-3 print:grid-cols-4 print:gap-1">
          <Card className="print:border-0 print:shadow-none"><CardContent className="pt-6 print:pt-1 print:pb-1"><p className="text-sm text-muted-foreground print:text-[7pt]">Requested By</p><p className="font-medium print:text-xs">{wo.requester_name}</p></CardContent></Card>
          <Card className="print:border-0 print:shadow-none"><CardContent className="pt-6 print:pt-1 print:pb-1"><p className="text-sm text-muted-foreground print:text-[7pt]">Operator</p><p className="font-medium print:text-xs">{wo.operator?.name || "—"}</p></CardContent></Card>
          <Card className="print:border-0 print:shadow-none"><CardContent className="pt-6 print:pt-1 print:pb-1"><p className="text-sm text-muted-foreground print:text-[7pt]">Engineer</p><p className="font-medium print:text-xs">{wo.engineer?.name || "—"}</p></CardContent></Card>
          {wo.closer?.name && <Card className="print:border-0 print:shadow-none"><CardContent className="pt-6 print:pt-1 print:pb-1"><p className="text-sm text-muted-foreground print:text-[7pt]">Closed By</p><p className="font-medium print:text-xs">{wo.closer.name}</p></CardContent></Card>}
          {wo.signed_by_name && <Card className="print:border-0 print:shadow-none"><CardContent className="pt-6 print:pt-1 print:pb-1"><p className="text-sm text-muted-foreground print:text-[7pt]">Signed By</p><p className="font-medium print:text-xs flex items-center gap-1"><PenTool className="h-3 w-3" />{wo.signed_by_name}</p></CardContent></Card>}
        </div>

        {/* Calculated Metrics - compact inline for print */}
        <div className="grid gap-4 md:grid-cols-4 print:grid-cols-4 print:gap-1">
          <Card className="print:border-0 print:shadow-none"><CardContent className="pt-6 print:pt-1 print:pb-1"><p className="text-sm text-muted-foreground print:text-[7pt]">Response Time</p><p className="text-xl font-bold print:text-sm">{formatDuration(responseTime)}</p></CardContent></Card>
          <Card className="print:border-0 print:shadow-none"><CardContent className="pt-6 print:pt-1 print:pb-1"><p className="text-sm text-muted-foreground print:text-[7pt]">Travel Time</p><p className="text-xl font-bold print:text-sm">{formatDuration(travelTime)}</p></CardContent></Card>
          <Card className="print:border-0 print:shadow-none"><CardContent className="pt-6 print:pt-1 print:pb-1"><p className="text-sm text-muted-foreground print:text-[7pt]">Repair Time</p><p className="text-xl font-bold print:text-sm">{formatDuration(repairTime)}</p></CardContent></Card>
          <Card className="print:border-0 print:shadow-none"><CardContent className="pt-6 print:pt-1 print:pb-1"><p className="text-sm text-muted-foreground print:text-[7pt]">Total Time</p><p className="text-xl font-bold print:text-sm">{formatDuration(totalTime)}</p></CardContent></Card>
        </div>

        <Card className="print:border-0 print:shadow-none">
          <CardHeader className="print:pb-1 print:pt-2"><CardTitle className="text-base print:text-sm">Timeline</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-4 print:space-y-1 print:flex print:flex-wrap print:gap-x-4 print:gap-y-1">
              <TimelineItem icon={Clock} label="Created" time={wo.created_at} className="bg-blue-100 text-blue-700" />
              <TimelineItem icon={Phone} label="Received" time={wo.received_at} className="bg-indigo-100 text-indigo-700" />
              <TimelineItem icon={MapPin} label="Arrived" time={wo.arrived_at} className="bg-purple-100 text-purple-700" />
              <TimelineItem icon={Play} label="Started" time={wo.started_at} className="bg-amber-100 text-amber-700" />
              <TimelineItem icon={Wrench} label="Finished" time={wo.finished_at} className="bg-teal-100 text-teal-700" />
              {wo.closed_at && <TimelineItem icon={CheckCircle} label="Closed" time={wo.closed_at} className="bg-green-100 text-green-700" />}
              {wo.completed_at && !wo.closed_at && wo.status !== "force_closed" && <TimelineItem icon={CheckCircle} label="Completed" time={wo.completed_at} className="bg-green-100 text-green-700" />}
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

        {/* Photos - hidden in print */}
        {woPhotos && woPhotos.length > 0 && (
          <Card className="print:hidden">
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

        {/* Cost Breakdown - hidden in print, admin only */}
        {costBreakdown && costBreakdown.totalCost > 0 && (
          <Card className="print:hidden">
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><DollarSign className="h-4 w-4" /> Cost Breakdown</CardTitle></CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-4">
                <div><p className="text-sm text-muted-foreground">Parts Cost</p><p className="text-xl font-bold">£{costBreakdown.partsCost.toFixed(2)}</p></div>
                <div><p className="text-sm text-muted-foreground">Labor Cost ({costBreakdown.repairHours}h)</p><p className="text-xl font-bold">£{costBreakdown.laborCost.toFixed(2)}</p></div>
                <div><p className="text-sm text-muted-foreground">Overtime</p><p className="text-xl font-bold">{costBreakdown.overtimeCost > 0 ? <span className="text-destructive">£{costBreakdown.overtimeCost.toFixed(2)}</span> : "—"}</p></div>
                <div><p className="text-sm text-muted-foreground">Total Cost</p><p className="text-2xl font-bold text-primary">£{costBreakdown.totalCost.toFixed(2)}</p></div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Requester Signature (print only) */}
        <div className="hidden print:block mt-4 pt-3 border-t border-foreground">
          <div className="grid grid-cols-2 gap-8">
            <div>
              <p className="text-xs font-medium mb-6">Requested By:</p>
              <div className="border-b border-foreground w-full" />
              <p className="text-xs mt-1">{wo.requester_name}</p>
            </div>
            <div>
              <p className="text-xs font-medium mb-6">Approved By:</p>
              <div className="border-b border-foreground w-full" />
              <p className="text-xs mt-1">Signature / Name</p>
            </div>
          </div>
          <p className="text-[7pt] text-muted-foreground mt-2 text-center">Date: {format(new Date(), "dd/MM/yyyy")}</p>
        </div>

        {/* Internal Chat - hidden in print */}
        <div className="print:hidden">
          <WOChat workOrderId={wo.id} />
        </div>
      </div>
    </DashboardLayout>
  );
}
