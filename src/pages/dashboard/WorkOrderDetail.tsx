import { useMemo, useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Loader2, Clock, Play, CheckCircle, XCircle, Printer, PenTool, Phone, MapPin, Wrench, Lock, Camera, DollarSign, ClipboardCheck, AlertOctagon, CheckSquare, Square, FileText } from "lucide-react";
import { useWorkOrderById } from "@/hooks/useWorkOrders";
import { usePartsUsedByWO } from "@/hooks/useStock";
import { useWOPhotos, getWOPhotoUrl } from "@/hooks/useWOPhotos";
import { useChecklistResponses, useChecklistsByProblemName } from "@/hooks/useChecklists";
import { useDowntimeEvents } from "@/hooks/useDowntimeEvents";

import { format, differenceInMinutes, differenceInSeconds } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { LineDowntimeControl } from "@/components/LineDowntimeControl";
import { DowntimeTimelineCard } from "@/components/DowntimeTimelineCard";


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
  if (minutes === null || minutes === undefined) return "—";
  if (minutes < 1) return "<1 min";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}

function formatShortDuration(seconds: number) {
  if (seconds < 60) return `${seconds} seg`;
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return sec === 0 ? `${min} min` : `${min}min ${sec}s`;
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
  const { data: downtimeEvents = [] } = useDowntimeEvents(id);

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

  // ── New simplified metric model (post Accept/Start split) ──────────────
  // Resposta = created → accepted (or first action) | Execução = started → finished | Total = created → finished
  const acceptedAt = (wo as any).accepted_at || wo.received_at || wo.started_at;
  const responseMin = acceptedAt
    ? differenceInMinutes(new Date(acceptedAt), new Date(wo.created_at))
    : null;
  const executionMin = wo.started_at && (wo.finished_at || wo.completed_at)
    ? differenceInMinutes(new Date(wo.finished_at || wo.completed_at!), new Date(wo.started_at))
    : null;
  const totalMin = (wo.finished_at || wo.completed_at || wo.closed_at)
    ? differenceInMinutes(new Date(wo.finished_at || wo.closed_at || wo.completed_at!), new Date(wo.created_at))
    : null;

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-3xl print-content" id="wo-print-content">

        {/* ═══ PRINT-ONLY: Industrial Document Header ═══ */}
        <div className="hidden print:block mb-4">
          <div className="flex items-center justify-between border-b-2 border-black pb-3">
            <div className="flex items-center gap-3">
              <img src="/appliedlogo.jpeg" alt="Logo" crossOrigin="anonymous" className="h-12 w-auto object-contain" onError={(e) => (e.currentTarget.style.display = 'none')} />
              <div>
                <p className="text-lg font-bold tracking-wide">AN MAINTENANCE</p>
                <p className="text-[8pt] text-gray-500">Applied Nutrition Ltd.</p>
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
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => window.print()} className="gap-2">
              <Printer className="h-4 w-4" /> Print
            </Button>
            <Button variant="outline" size="sm" onClick={async () => {
              const el = document.getElementById("wo-print-content");
              if (!el) return;
              const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
                import("html2canvas"),
                import("jspdf"),
              ]);
              document.body.classList.add("pdf-export");
              try {
                const canvas = await html2canvas(el, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
                const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
                const pageW = 210, pageH = 297, margin = 10;
                const imgW = pageW - margin * 2;
                const imgH = (canvas.height * imgW) / canvas.width;
                const imgData = canvas.toDataURL("image/png");
                let heightLeft = imgH;
                let position = margin;
                pdf.addImage(imgData, "PNG", margin, position, imgW, imgH);
                heightLeft -= pageH - margin * 2;
                while (heightLeft > 0) {
                  pdf.addPage();
                  position = margin - (imgH - heightLeft);
                  pdf.addImage(imgData, "PNG", margin, position, imgW, imgH);
                  heightLeft -= pageH - margin * 2;
                }
                pdf.save(`${woLabel}_${format(new Date(), "yyyyMMdd")}.pdf`);
              } finally {
                document.body.classList.remove("pdf-export");
              }
            }} className="gap-2">
              <Printer className="h-4 w-4" /> PDF
            </Button>
          </div>
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

        {/* Production Line Status — multi-cycle stop/resume control */}
        <div className="print:hidden">
          <LineDowntimeControl
            workOrderId={wo.id}
            workOrderStatus={wo.status}
            operatorId={(wo as any).operator_id}
            engineerId={(wo as any).engineer_id}
          />
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

        {/* Personnel — "Signed By" removed (operator signature is in footer) */}
        <div className="grid gap-4 md:grid-cols-3 print:grid-cols-3 print:gap-0">
          <Card className="print:border print:border-black print:shadow-none print:rounded-none"><CardContent className="pt-6 print:pt-1 print:pb-1"><p className="text-sm text-muted-foreground print:text-[7pt] print:font-bold">Requested By</p><p className="font-medium print:text-[9pt]">{wo.requester_name}</p></CardContent></Card>
          <Card className="print:border print:border-black print:shadow-none print:rounded-none"><CardContent className="pt-6 print:pt-1 print:pb-1"><p className="text-sm text-muted-foreground print:text-[7pt] print:font-bold">Engineer</p><p className="font-medium print:text-[9pt]">{wo.engineer_name || wo.engineer?.name || ""}</p></CardContent></Card>
          {wo.closer?.name && <Card className="print:border print:border-black print:shadow-none print:rounded-none"><CardContent className="pt-6 print:pt-1 print:pb-1"><p className="text-sm text-muted-foreground print:text-[7pt] print:font-bold">Closed By</p><p className="font-medium print:text-[9pt]">{wo.closer.name}</p></CardContent></Card>}
        </div>

        {/* TEMPOS DE ATENDIMENTO */}
        <Card className="print:border print:border-black print:shadow-none print:rounded-none print:break-inside-avoid">
          <CardHeader className="print:pb-1 print:pt-2 pb-3"><CardTitle className="text-xs uppercase tracking-wider text-muted-foreground print:text-[8pt] print:font-bold print:text-black">Tempos de Atendimento</CardTitle></CardHeader>
          <CardContent className="print:pt-0">
            <div className="grid grid-cols-3 gap-4 print:gap-0">
              <div className="text-center print:border print:border-black print:py-2"><p className="text-[10pt] uppercase tracking-wide text-muted-foreground print:text-[7pt] print:font-bold print:text-black">Resposta</p><p className="text-[9pt] text-muted-foreground mb-2 print:text-[6pt] print:mb-1">abertura → aceitação</p><p className="text-3xl font-bold print:text-base">{formatDuration(responseMin)}</p></div>
              <div className="text-center print:border print:border-l-0 print:border-black print:py-2"><p className="text-[10pt] uppercase tracking-wide text-muted-foreground print:text-[7pt] print:font-bold print:text-black">Execução</p><p className="text-[9pt] text-muted-foreground mb-2 print:text-[6pt] print:mb-1">início → término</p><p className="text-3xl font-bold print:text-base">{formatDuration(executionMin)}</p></div>
              <div className="text-center print:border print:border-l-0 print:border-black print:py-2"><p className="text-[10pt] uppercase tracking-wide text-muted-foreground print:text-[7pt] print:font-bold print:text-black">Tempo Total</p><p className="text-[9pt] text-muted-foreground mb-2 print:text-[6pt] print:mb-1">abertura → término</p><p className="text-3xl font-bold print:text-base">{formatDuration(totalMin)}</p></div>
            </div>
          </CardContent>
        </Card>

        {/* IMPACTO NA PRODUÇÃO */}
        {(() => {
          const stopCount = downtimeEvents.length;
          const totalDowntimeSec = downtimeEvents.reduce((acc, e) => {
            if (e.duration_minutes != null) return acc + e.duration_minutes * 60;
            if (e.resumed_at) return acc + differenceInSeconds(new Date(e.resumed_at), new Date(e.stopped_at));
            return acc + differenceInSeconds(new Date(), new Date(e.stopped_at));
          }, 0);
          const lineOperating = !(wo as any).line_stopped;
          return (
            <Card className="print:border print:border-black print:shadow-none print:rounded-none print:break-inside-avoid">
              <CardHeader className="print:pb-1 print:pt-2 pb-3"><CardTitle className="text-xs uppercase tracking-wider text-muted-foreground print:text-[8pt] print:font-bold print:text-black">Impacto na Produção</CardTitle></CardHeader>
              <CardContent className="print:pt-0">
                <div className="grid grid-cols-3 gap-4 print:gap-0">
                  <div className="text-center print:border print:border-black print:py-2">
                    <p className="text-[10pt] uppercase tracking-wide text-muted-foreground print:text-[7pt] print:font-bold print:text-black">Status da Linha</p>
                    <p className="text-[9pt] text-muted-foreground mb-2 print:text-[6pt] print:mb-1">no fechamento</p>
                    <p className={`text-2xl font-bold flex items-center justify-center gap-1 print:text-base ${lineOperating ? "text-emerald-600" : "text-destructive"}`}>
                      {lineOperating ? <><CheckCircle className="h-5 w-5 print:hidden" /> Operando</> : <><AlertOctagon className="h-5 w-5 print:hidden" /> Parada</>}
                    </p>
                  </div>
                  <div className="text-center print:border print:border-l-0 print:border-black print:py-2"><p className="text-[10pt] uppercase tracking-wide text-muted-foreground print:text-[7pt] print:font-bold print:text-black">Paradas</p><p className="text-[9pt] text-muted-foreground mb-2 print:text-[6pt] print:mb-1">registradas</p><p className="text-3xl font-bold print:text-base">{stopCount}</p></div>
                  <div className="text-center print:border print:border-l-0 print:border-black print:py-2"><p className="text-[10pt] uppercase tracking-wide text-muted-foreground print:text-[7pt] print:font-bold print:text-black">Downtime Total</p><p className="text-[9pt] text-muted-foreground mb-2 print:text-[6pt] print:mb-1">tempo parada</p><p className="text-3xl font-bold print:text-base">{stopCount === 0 ? "—" : formatShortDuration(totalDowntimeSec)}</p></div>
                </div>
              </CardContent>
            </Card>
          );
        })()}

        {/* LINHA DO TEMPO — vertical, deduped (one row per real event) */}
        <Card className="print:border print:border-black print:shadow-none print:rounded-none print:break-inside-avoid">
          <CardHeader className="print:pb-1 print:pt-2 pb-3"><CardTitle className="text-xs uppercase tracking-wider text-muted-foreground print:text-[8pt] print:font-bold print:text-black">Linha do Tempo</CardTitle></CardHeader>
          <CardContent>
            {(() => {
              type Ev = { ts: string; icon: "open" | "stop" | "resume" | "done" | "force"; title: string; sub?: string; delta?: string };
              const evs: Ev[] = [];
              const created = new Date(wo.created_at);
              evs.push({ ts: wo.created_at, icon: "open", title: "Ordem criada", sub: `por ${wo.requester_name} (operador)` });
              if (acceptedAt) {
                const dMin = differenceInMinutes(new Date(acceptedAt), created);
                evs.push({ ts: acceptedAt, icon: "open", title: "Ordem aceita (PIN ✓)", sub: `por ${wo.engineer_name || "—"}`, delta: dMin > 0 ? `${dMin}min após abertura` : undefined });
              }
              if (wo.started_at && wo.started_at !== acceptedAt) {
                evs.push({ ts: wo.started_at, icon: "open", title: "Trabalho iniciado", sub: `por ${wo.engineer_name || "—"}` });
              }
              downtimeEvents.forEach((d) => {
                evs.push({ ts: d.stopped_at, icon: "stop", title: "Linha marcada como parada", sub: `por ${d.stopped_by_name || "—"}${d.stopped_reason ? ` — motivo: "${d.stopped_reason}"` : ""}` });
                if (d.resumed_at) {
                  const dur = formatShortDuration(differenceInSeconds(new Date(d.resumed_at), new Date(d.stopped_at)));
                  evs.push({ ts: d.resumed_at, icon: "resume", title: "Linha voltou a operar", sub: `por ${d.resumed_by_name || "—"} — parada: ${dur}` });
                }
              });
              if (wo.finished_at) evs.push({ ts: wo.finished_at, icon: "done", title: "Finalizada (PIN ✓)", sub: `por ${wo.engineer_name || "—"}` });
              if (wo.closed_at) evs.push({ ts: wo.closed_at, icon: "done", title: "Fechada", sub: wo.closer?.name ? `por ${wo.closer.name}` : undefined });
              if (wo.status === "force_closed" && wo.completed_at) evs.push({ ts: wo.completed_at, icon: "force", title: "Fechamento forçado", sub: wo.closer?.name ? `por ${wo.closer.name}` : undefined });
              evs.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
              const iconFor = (i: Ev["icon"]) => {
                if (i === "stop") return <span className="text-destructive">🛑</span>;
                if (i === "resume") return <span className="text-emerald-600">✓</span>;
                if (i === "force") return <span className="text-muted-foreground">✕</span>;
                return <span className="text-primary">●</span>;
              };
              return (
                <ol className="relative border-l border-border pl-5 space-y-4 print:space-y-2">
                  {evs.map((e, i) => (
                    <li key={i} className="text-sm print:text-[8pt]">
                      <div className="flex items-baseline gap-2">
                        <span className="-ml-7 w-5 text-center inline-block">{iconFor(e.icon)}</span>
                        <span className="font-mono text-xs print:text-[7pt] text-muted-foreground">{format(new Date(e.ts), "dd/MM HH:mm:ss")}</span>
                        <span className="font-medium">{e.title}</span>
                        {e.delta && <span className="text-xs print:text-[7pt] text-muted-foreground">— {e.delta}</span>}
                      </div>
                      {e.sub && <p className="ml-1 text-xs print:text-[7pt] text-muted-foreground">{e.sub}</p>}
                    </li>
                  ))}
                </ol>
              );
            })()}
          </CardContent>
        </Card>

        {/* HISTÓRICO DE PARADAS DA LINHA — only renders if there are events */}
        {downtimeEvents.length > 0 && (
          <Card className="print:border print:border-black print:shadow-none print:rounded-none print:break-inside-avoid">
            <CardHeader className="print:pb-1 print:pt-2 pb-3"><CardTitle className="text-xs uppercase tracking-wider text-muted-foreground print:text-[8pt] print:font-bold print:text-black">Histórico de Paradas da Linha</CardTitle></CardHeader>
            <CardContent>
              <table className="w-full text-sm print:text-[8pt] border-collapse">
                <thead>
                  <tr className="bg-muted print:bg-gray-100">
                    <th className="text-left px-2 py-1 font-bold print:border print:border-black w-10">#</th>
                    <th className="text-left px-2 py-1 font-bold print:border print:border-black">Parou</th>
                    <th className="text-left px-2 py-1 font-bold print:border print:border-black">Voltou</th>
                    <th className="text-left px-2 py-1 font-bold print:border print:border-black">Duração</th>
                    <th className="text-left px-2 py-1 font-bold print:border print:border-black">Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {downtimeEvents.map((d, i) => {
                    const dur = d.resumed_at
                      ? formatShortDuration(differenceInSeconds(new Date(d.resumed_at), new Date(d.stopped_at)))
                      : <span className="text-destructive font-medium">em andamento</span>;
                    return (
                      <tr key={d.id} className={i % 2 === 1 ? "bg-muted/30 print:bg-gray-50" : ""}>
                        <td className="px-2 py-1 print:border print:border-black font-mono">{i + 1}</td>
                        <td className="px-2 py-1 print:border print:border-black font-mono">{format(new Date(d.stopped_at), "dd/MM HH:mm:ss")}</td>
                        <td className="px-2 py-1 print:border print:border-black font-mono">{d.resumed_at ? format(new Date(d.resumed_at), "dd/MM HH:mm:ss") : "—"}</td>
                        <td className="px-2 py-1 print:border print:border-black">{dur}</td>
                        <td className="px-2 py-1 print:border print:border-black">{d.stopped_reason || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="font-bold border-t-2 border-border">
                    <td colSpan={5} className="px-2 py-1 print:border print:border-black">
                      TOTAL: {downtimeEvents.length} parada{downtimeEvents.length !== 1 ? "s" : ""} · {formatShortDuration(downtimeEvents.reduce((acc, e) => acc + (e.resumed_at ? differenceInSeconds(new Date(e.resumed_at), new Date(e.stopped_at)) : differenceInSeconds(new Date(), new Date(e.stopped_at))), 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </CardContent>
          </Card>
        )}

        {/* CHECKLIST EXECUTADO — groups by type, shows completed_by + completed_at */}
        {checklistItems && checklistItems.length > 0 && (
          <Card className="print:border print:border-black print:shadow-none print:rounded-none print:break-inside-avoid">
            <CardHeader className="print:pb-1 print:pt-2 pb-3"><CardTitle className="text-xs uppercase tracking-wider text-muted-foreground print:text-[8pt] print:font-bold print:text-black flex items-center gap-2"><ClipboardCheck className="h-4 w-4 print:hidden" /> Checklist Executado</CardTitle></CardHeader>
            <CardContent>
              {(() => {
                const groups: Record<string, typeof checklistItems> = {};
                checklistItems.forEach((it) => { (groups[it.type] ||= [] as any).push(it); });
                const required = checklistItems.filter((i) => i.is_required);
                const requiredDone = required.filter((i) => checklistResponses?.find((r) => r.checklist_id === i.id && r.completed)).length;
                return (
                  <div className="space-y-3 print:space-y-1">
                    {Object.entries(groups).map(([type, items]) => (
                      <div key={type}>
                        <p className="text-xs uppercase tracking-wide font-bold text-muted-foreground mb-1 print:text-[7pt]">{type}</p>
                        <ul className="space-y-1 ml-2">
                          {items.map((it) => {
                            const r = checklistResponses?.find((x) => x.checklist_id === it.id);
                            const done = r?.completed;
                            return (
                              <li key={it.id} className="text-sm print:text-[8pt] flex items-start gap-2">
                                {done ? <CheckSquare className="h-4 w-4 text-emerald-600 mt-0.5 print:h-3 print:w-3" /> : <Square className="h-4 w-4 text-muted-foreground mt-0.5 print:h-3 print:w-3" />}
                                <div>
                                  <span>{it.description}{it.is_required && <span className="text-destructive ml-1">*</span>}</span>
                                  {done && r?.completed_at && (
                                    <p className="text-xs print:text-[7pt] text-muted-foreground">{wo.engineer_name || "—"} · {format(new Date(r.completed_at), "dd/MM HH:mm:ss")}</p>
                                  )}
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ))}
                    <p className="text-xs print:text-[7pt] font-medium pt-2 border-t border-border mt-2">STATUS: {requiredDone}/{required.length} itens obrigatórios completos {requiredDone === required.length && required.length > 0 ? "✓" : ""}</p>
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        )}

        {/* Multi-cycle line stop history (screen-only rich timeline) */}
        <div className="print:hidden">
          <DowntimeTimelineCard workOrderId={wo.id} />
        </div>
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
              <p className="text-[8pt] mb-1">Name: <span className="font-medium">{wo.requester_name || wo.operator?.name || ""}</span></p>
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
