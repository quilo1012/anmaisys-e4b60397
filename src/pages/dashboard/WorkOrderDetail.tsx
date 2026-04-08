import { useMemo, useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Loader2, Clock, Play, CheckCircle, XCircle, Printer, PenTool, Phone, MapPin, Wrench, Lock, Camera, DollarSign, ClipboardCheck } from "lucide-react";
import { useWorkOrderById } from "@/hooks/useWorkOrders";
import { usePartsUsedByWO } from "@/hooks/useStock";
import { useWOPhotos, getWOPhotoUrl } from "@/hooks/useWOPhotos";
import { useChecklistResponses, useChecklistsByProblemName } from "@/hooks/useChecklists";

import { format, differenceInMinutes } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import appliedLogo from "@/assets/appliedlogo.jpeg";

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
  if (minutes === null) return "";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}min`;
}

// Timeline data for print audit table
function getTimelineRows(wo: any) {
  const rows: { step: string; timestamp: string }[] = [];
  if (wo.created_at) rows.push({ step: "Created", timestamp: format(new Date(wo.created_at), "dd/MM/yyyy HH:mm:ss") });
  if (wo.received_at) rows.push({ step: "Received", timestamp: format(new Date(wo.received_at), "dd/MM/yyyy HH:mm:ss") });
  if (wo.arrived_at) rows.push({ step: "Arrived", timestamp: format(new Date(wo.arrived_at), "dd/MM/yyyy HH:mm:ss") });
  if (wo.started_at) rows.push({ step: "Started", timestamp: format(new Date(wo.started_at), "dd/MM/yyyy HH:mm:ss") });
  if (wo.finished_at) rows.push({ step: "Finished", timestamp: format(new Date(wo.finished_at), "dd/MM/yyyy HH:mm:ss") });
  if (wo.closed_at) rows.push({ step: "Closed", timestamp: format(new Date(wo.closed_at), "dd/MM/yyyy HH:mm:ss") });
  else if (wo.completed_at && wo.status !== "force_closed") rows.push({ step: "Completed", timestamp: format(new Date(wo.completed_at), "dd/MM/yyyy HH:mm:ss") });
  if (wo.status === "force_closed" && wo.completed_at) rows.push({ step: "Force Closed", timestamp: format(new Date(wo.completed_at), "dd/MM/yyyy HH:mm:ss") });
  return rows;
}

function SignedPhoto({ storagePath, alt }: { storagePath: string; alt: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    getWOPhotoUrl(storagePath).then(setUrl);
  }, [storagePath]);
  if (!url) return <div className="h-32 bg-muted rounded-lg animate-pulse" />;
  return <img src={url} alt={alt} className="rounded-lg border w-full max-h-64 object-cover" />;
}

export default function WorkOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const { data: wo, isLoading } = useWorkOrderById(id!);
  const { data: partsUsed, isLoading: partsLoading } = usePartsUsedByWO(id!);
  const { data: woPhotos } = useWOPhotos(id!);
  const { data: checklistResponses } = useChecklistResponses(id);
  const { data: checklistItems } = useChecklistsByProblemName(wo?.description);

  const { data: woLogs } = useQuery({
    queryKey: ["work_order_logs", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_order_logs" as any)
        .select("*")
        .eq("work_order_id", id!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!id,
  });

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

  const responseTime = wo.received_at
    ? differenceInMinutes(new Date(wo.received_at), new Date(wo.created_at))
    : wo.started_at
      ? differenceInMinutes(new Date(wo.started_at), new Date(wo.created_at))
      : null;
  const travelTime = wo.arrived_at
    ? differenceInMinutes(new Date(wo.arrived_at), new Date(wo.received_at || wo.created_at))
    : wo.started_at && !wo.received_at ? 0 : null;
  const pausedMinutes = (wo as any).total_paused_minutes || 0;
  const rawRepairTime = wo.started_at && (wo.finished_at || wo.completed_at) ? differenceInMinutes(new Date(wo.finished_at || wo.completed_at!), new Date(wo.started_at)) : null;
  const repairTime = rawRepairTime !== null ? rawRepairTime - pausedMinutes : null;
  const totalTime = (wo.closed_at || wo.completed_at) ? differenceInMinutes(new Date(wo.closed_at || wo.completed_at!), new Date(wo.created_at)) : null;

  const timelineRows = getTimelineRows(wo);

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-3xl print-content" id="wo-print-content">

        {/* ═══ PRINT-ONLY: Background Watermark ═══ */}
        <div className="print-watermark" aria-hidden="true">
          <img src={appliedLogo} alt="" className="w-72 h-72 object-contain opacity-[0.08]" />
        </div>

        {/* ═══ PRINT-ONLY: Industrial Document Header ═══ */}
        <div className="hidden print:block mb-4">
          <div className="flex items-center justify-between border-b-2 border-black pb-3">
            <div className="flex items-center gap-3">
              <img src={appliedLogo} alt="AN" className="h-10 w-10 object-contain" />
              <div>
                <p className="text-base font-bold tracking-wide">AN MAINTENANCE</p>
                <p className="text-[7pt] text-gray-600">Applied Nutrition Ltd.</p>
              </div>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold tracking-widest">WORK ORDER</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold font-mono">{woLabel}</p>
              <p className="text-[8pt] text-gray-600">{format(new Date(wo.created_at), "dd/MM/yyyy HH:mm")}</p>
            </div>
          </div>
          {/* Document metadata row */}
          <div className="grid grid-cols-4 border border-black border-t-0 text-[8pt]">
            <div className="border-r border-black px-2 py-1"><span className="font-bold">Priority:</span> {pri.label}</div>
            <div className="border-r border-black px-2 py-1"><span className="font-bold">Status:</span> {cfg.label}</div>
            <div className="border-r border-black px-2 py-1"><span className="font-bold">Machine:</span> {wo.machine}</div>
            <div className="px-2 py-1"><span className="font-bold">Requester:</span> {wo.requester_name}</div>
          </div>
        </div>

        {/* Screen-only navigation */}
        <div className="flex items-center justify-between print:hidden">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-2">
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()} className="gap-2">
            <Printer className="h-4 w-4" /> Print
          </Button>
        </div>

        {/* Screen-only title with badges */}
        <div className="flex items-center justify-between print:hidden">
          <div>
            <h2 className="text-2xl font-bold">{wo.requester_name} — {wo.machine}</h2>
            <p className="text-muted-foreground text-sm font-mono">{woLabel}</p>
          </div>
          <div className="flex gap-2">
            <Badge variant="outline" className={`text-sm px-3 py-1 ${pri.className}`}>{pri.label}</Badge>
            <Badge variant="outline" className={`text-sm px-3 py-1 ${cfg.className}`}>{cfg.label}</Badge>
          </div>
        </div>

        {/* Problem Description */}
        <Card className="print:border print:border-black print:shadow-none print:rounded-none">
          <CardHeader className="print:pb-1 print:pt-2"><CardTitle className="text-base print:text-sm print:font-bold">Problem Description</CardTitle></CardHeader>
          <CardContent className="print:pb-2">
            <p className="print:text-[9pt]">{wo.description}</p>
            {wo.notes && (
              <div className="mt-2 pt-2 border-t print:mt-1 print:pt-1">
                <p className="text-sm font-medium print:text-[8pt] print:font-bold">Observations:</p>
                <p className="print:text-[9pt]">{wo.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Screen-only notes card */}
        {wo.notes && (
          <Card className="print:hidden">
            <CardHeader><CardTitle className="text-base">Observations</CardTitle></CardHeader>
            <CardContent><p>{wo.notes}</p></CardContent>
          </Card>
        )}

        {/* Personnel */}
        <div className="grid gap-4 md:grid-cols-3 print:grid-cols-4 print:gap-0">
          <Card className="print:border print:border-black print:shadow-none print:rounded-none"><CardContent className="pt-6 print:pt-1 print:pb-1"><p className="text-sm text-muted-foreground print:text-[7pt] print:font-bold">Requested By</p><p className="font-medium print:text-[9pt]">{wo.requester_name}</p></CardContent></Card>
          <Card className="print:border print:border-black print:shadow-none print:rounded-none"><CardContent className="pt-6 print:pt-1 print:pb-1"><p className="text-sm text-muted-foreground print:text-[7pt] print:font-bold">Operator</p><p className="font-medium print:text-[9pt]">{wo.operator?.name || wo.requester_name || ""}</p></CardContent></Card>
          <Card className="print:border print:border-black print:shadow-none print:rounded-none"><CardContent className="pt-6 print:pt-1 print:pb-1"><p className="text-sm text-muted-foreground print:text-[7pt] print:font-bold">Engineer</p><p className="font-medium print:text-[9pt]">{wo.engineer_name || wo.engineer?.name || ""}</p></CardContent></Card>
          {wo.closer?.name && <Card className="print:border print:border-black print:shadow-none print:rounded-none"><CardContent className="pt-6 print:pt-1 print:pb-1"><p className="text-sm text-muted-foreground print:text-[7pt] print:font-bold">Closed By</p><p className="font-medium print:text-[9pt]">{wo.closer.name}</p></CardContent></Card>}
          {wo.signed_by_name && <Card className="print:border print:border-black print:shadow-none print:rounded-none"><CardContent className="pt-6 print:pt-1 print:pb-1"><p className="text-sm text-muted-foreground print:text-[7pt] print:font-bold">Signed By</p><p className="font-medium print:text-[9pt] flex items-center gap-1"><PenTool className="h-3 w-3 print:hidden" />{wo.signed_by_name}</p></CardContent></Card>}
        </div>

        {/* Metrics */}
        <div className="grid gap-4 md:grid-cols-4 print:grid-cols-4 print:gap-0">
          <Card className="print:border print:border-black print:shadow-none print:rounded-none"><CardContent className="pt-6 print:pt-1 print:pb-1"><p className="text-sm text-muted-foreground print:text-[7pt] print:font-bold">Response Time</p><p className="text-xl font-bold print:text-sm">{formatDuration(responseTime)}</p></CardContent></Card>
          <Card className="print:border print:border-black print:shadow-none print:rounded-none"><CardContent className="pt-6 print:pt-1 print:pb-1"><p className="text-sm text-muted-foreground print:text-[7pt] print:font-bold">Travel Time</p><p className="text-xl font-bold print:text-sm">{formatDuration(travelTime)}</p></CardContent></Card>
          <Card className="print:border print:border-black print:shadow-none print:rounded-none"><CardContent className="pt-6 print:pt-1 print:pb-1"><p className="text-sm text-muted-foreground print:text-[7pt] print:font-bold">Repair Time</p><p className="text-xl font-bold print:text-sm">{formatDuration(repairTime)}</p>{pausedMinutes > 0 && <p className="text-xs text-muted-foreground">({formatDuration(pausedMinutes)} paused)</p>}</CardContent></Card>
          <Card className="print:border print:border-black print:shadow-none print:rounded-none"><CardContent className="pt-6 print:pt-1 print:pb-1"><p className="text-sm text-muted-foreground print:text-[7pt] print:font-bold">Total Time</p><p className="text-xl font-bold print:text-sm">{formatDuration(totalTime)}</p></CardContent></Card>
        </div>

        {/* Timeline — Screen: icon-based, Print: audit table */}
        <Card className="print:border print:border-black print:shadow-none print:rounded-none">
          <CardHeader className="print:pb-1 print:pt-2"><CardTitle className="text-base print:text-sm print:font-bold">Timeline</CardTitle></CardHeader>
          <CardContent>
            {/* Screen version */}
            <div className="space-y-4 print:hidden">
              <TimelineItem icon={Clock} label="Created" time={wo.created_at} className="bg-blue-100 text-blue-700" />
              <TimelineItem icon={Phone} label="Received" time={wo.received_at} className="bg-indigo-100 text-indigo-700" />
              <TimelineItem icon={MapPin} label="Arrived" time={wo.arrived_at} className="bg-purple-100 text-purple-700" />
              <TimelineItem icon={Play} label="Started" time={wo.started_at} className="bg-amber-100 text-amber-700" />
              {(wo as any).pause_reason && (
                <div className="flex items-start gap-3">
                  <div className="rounded-full p-1.5 bg-yellow-100 text-yellow-700"><Wrench className="h-4 w-4" /></div>
                  <div>
                    <p className="font-medium text-sm">Paused</p>
                    <p className="text-xs text-muted-foreground">Reason: {(wo as any).pause_reason}</p>
                  </div>
                </div>
              )}
              <TimelineItem icon={Wrench} label="Finished" time={wo.finished_at} className="bg-teal-100 text-teal-700" />
              {wo.closed_at && <TimelineItem icon={CheckCircle} label="Closed" time={wo.closed_at} className="bg-green-100 text-green-700" />}
              {wo.completed_at && !wo.closed_at && wo.status !== "force_closed" && <TimelineItem icon={CheckCircle} label="Completed" time={wo.completed_at} className="bg-green-100 text-green-700" />}
              {wo.status === "force_closed" && <TimelineItem icon={XCircle} label="Force Closed" time={wo.completed_at} className="bg-gray-100 text-gray-700" />}
            </div>
            {/* Print version: bordered audit table */}
            <div className="hidden print:block">
              <table className="w-full text-[8pt] border-collapse">
                <thead>
                  <tr>
                    <th className="text-left border border-black bg-gray-100 px-2 py-1 font-bold">Step</th>
                    <th className="text-left border border-black bg-gray-100 px-2 py-1 font-bold">Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {timelineRows.map((row, i) => (
                    <tr key={i}>
                      <td className="border border-black px-2 py-1">{row.step}</td>
                      <td className="border border-black px-2 py-1 font-mono">{row.timestamp}</td>
                    </tr>
                  ))}
                  {(wo as any).pause_reason && (
                    <tr>
                      <td className="border border-black px-2 py-1">Pause Reason</td>
                      <td className="border border-black px-2 py-1">{(wo as any).pause_reason}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Action Log (work_order_logs) */}
        {woLogs && woLogs.length > 0 && (
          <Card className="print:border print:border-black print:shadow-none print:rounded-none">
            <CardHeader className="print:pb-1 print:pt-2"><CardTitle className="text-base print:text-sm print:font-bold">Action Log</CardTitle></CardHeader>
            <CardContent>
              <table className="w-full text-sm print:text-[8pt] border-collapse">
                <thead>
                  <tr>
                    <th className="text-left px-2 py-1 font-bold print:border print:border-black print:bg-gray-100">Action</th>
                    <th className="text-left px-2 py-1 font-bold print:border print:border-black print:bg-gray-100">Engineer</th>
                    <th className="text-left px-2 py-1 font-bold print:border print:border-black print:bg-gray-100">Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {woLogs.map((log: any) => (
                    <tr key={log.id}>
                      <td className="px-2 py-1 print:border print:border-black capitalize">{log.action}</td>
                      <td className="px-2 py-1 print:border print:border-black">{log.engineer_name}</td>
                      <td className="px-2 py-1 print:border print:border-black text-muted-foreground font-mono">{format(new Date(log.created_at), "dd/MM/yyyy HH:mm:ss")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

        {/* Checklist */}
        {checklistItems && checklistItems.length > 0 && (
          <Card className="print:border print:border-black print:shadow-none print:rounded-none">
            <CardHeader className="print:pb-1 print:pt-2"><CardTitle className="text-base print:text-sm print:font-bold flex items-center gap-2"><ClipboardCheck className="h-4 w-4 print:hidden" /> Checklist</CardTitle></CardHeader>
            <CardContent>
              <table className="w-full text-sm print:text-[8pt] border-collapse">
                <thead>
                  <tr>
                    <th className="text-left px-2 py-1 font-bold print:border print:border-black print:bg-gray-100">Item</th>
                    <th className="text-left px-2 py-1 font-bold print:border print:border-black print:bg-gray-100">Type</th>
                    <th className="text-center px-2 py-1 font-bold print:border print:border-black print:bg-gray-100 w-20">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {checklistItems.map((item) => {
                    const response = checklistResponses?.find((r) => r.checklist_id === item.id);
                    const completed = response?.completed || false;
                    return (
                      <tr key={item.id}>
                        <td className="px-2 py-1 print:border print:border-black">{item.description}{item.is_required && <span className="text-destructive ml-1">*</span>}</td>
                        <td className="px-2 py-1 print:border print:border-black text-muted-foreground">{item.type}</td>
                        <td className="px-2 py-1 print:border print:border-black text-center">
                          {completed ? <CheckCircle className="h-4 w-4 text-green-600 inline-block" /> : <XCircle className="h-4 w-4 text-muted-foreground inline-block" />}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

        {/* Parts Used */}
        <Card className="print:border print:border-black print:shadow-none print:rounded-none">
          <CardHeader className="print:pb-1 print:pt-2"><CardTitle className="text-base print:text-sm print:font-bold">Parts Used</CardTitle></CardHeader>
          <CardContent>
            {partsLoading ? (
              <div className="flex justify-center py-4 print:hidden"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : !partsUsed?.length ? (
              <p className="text-muted-foreground text-sm print:text-[8pt]">No parts registered for this work order.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="print:border print:border-black">
                    <TableHead className="print:border print:border-black print:bg-gray-100">Product</TableHead>
                    <TableHead className="print:border print:border-black print:bg-gray-100">Code</TableHead>
                    <TableHead className="print:border print:border-black print:bg-gray-100">Qty</TableHead>
                    <TableHead className="print:border print:border-black print:bg-gray-100">Engineer</TableHead>
                    <TableHead className="print:border print:border-black print:bg-gray-100">Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {partsUsed.map((pu) => (
                    <TableRow key={pu.id} className="print:border print:border-black">
                      <TableCell className="font-medium print:border print:border-black">{pu.product?.name || ""}</TableCell>
                      <TableCell className="print:border print:border-black">{pu.product?.code || ""}</TableCell>
                      <TableCell className="print:border print:border-black">{pu.quantity}</TableCell>
                      <TableCell className="print:border print:border-black">{(pu as any).engineer_name || pu.engineer?.name || wo.engineer_name || ""}</TableCell>
                      <TableCell className="text-sm text-muted-foreground print:border print:border-black">{format(new Date(pu.created_at), "dd/MM HH:mm")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Photos */}
        {woPhotos && woPhotos.length > 0 && (
          <Card className="print:border print:border-black print:shadow-none print:rounded-none">
            <CardHeader className="print:pb-1 print:pt-2"><CardTitle className="text-base print:text-sm print:font-bold flex items-center gap-2"><Camera className="h-4 w-4 print:hidden" /> Photos</CardTitle></CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2 print:grid-cols-2 print:gap-2">
                {["before", "after"].map((type) => {
                  const photos = woPhotos.filter((p) => p.photo_type === type);
                  return (
                    <div key={type}>
                      <p className="text-sm font-medium mb-2 capitalize print:text-[8pt] print:font-bold">{type}</p>
                      {photos.length ? (
                        <div className="grid gap-2">
                          {photos.map((p) => (
                            <SignedPhoto key={p.id} storagePath={p.storage_path} alt={`${type} photo`} />
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground print:text-[7pt]">No {type} photo</p>
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

        {/* ═══ PRINT-ONLY: Formal Signature Section ═══ */}
        <div className="hidden print:block mt-10 pt-4 border-t-2 border-black">
          <div className="grid grid-cols-2 gap-16">
            <div>
              <p className="text-[8pt] font-bold mb-1">Engineer Signature:</p>
              <p className="text-[8pt] mb-1">Name: <span className="font-medium">{wo.engineer_name || wo.engineer?.name || ""}</span></p>
              <p className="text-[8pt] mb-8">Date: {wo.started_at ? format(new Date(wo.started_at), "dd/MM/yyyy") : ""}</p>
              <div className="border-b-2 border-black w-full" />
              <p className="text-[7pt] mt-1 text-gray-500">Signature</p>
            </div>
            <div>
              <p className="text-[8pt] font-bold mb-1">Operator Signature:</p>
              <p className="text-[8pt] mb-1">Name: <span className="font-medium">{wo.operator?.name || wo.requester_name || ""}</span></p>
              <p className="text-[8pt] mb-8">Date: {format(new Date(wo.created_at), "dd/MM/yyyy")}</p>
              <div className="border-b-2 border-black w-full" />
              <p className="text-[7pt] mt-1 text-gray-500">Signature</p>
            </div>
          </div>
        </div>

        {/* Print footer */}
        <div className="print-footer hidden">AN Maintenance — Confidential — {woLabel}</div>

      </div>
    </DashboardLayout>
  );
}
