import { useMemo, useState, useEffect, useRef } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Loader2, Clock, Play, CheckCircle, XCircle, Printer, PenTool, Phone, MapPin, Wrench, Lock, Camera, DollarSign, ClipboardCheck, AlertOctagon, CheckSquare, Square, FileText } from "lucide-react";
import { useWorkOrderById, useWorkOrderAccessHint } from "@/hooks/useWorkOrders";
import { toast } from "sonner";
import { printElementAsDocument } from "@/lib/printDocument";
import { usePartsUsedByWO } from "@/hooks/useStock";
import { useWOPhotos, getWOPhotoUrl } from "@/hooks/useWOPhotos";
import { useChecklistResponses, useChecklistsByProblemName } from "@/hooks/useChecklists";
import { useDowntimeEvents } from "@/hooks/useDowntimeEvents";
import { useWoMetrics } from "@/hooks/useWoMetrics";

import { format, differenceInMinutes, differenceInSeconds } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { LineDowntimeControl } from "@/components/LineDowntimeControl";
import { RecordMissedDowntime } from "@/components/RecordMissedDowntime";
import { TeamActivityExclusions } from "@/components/TeamActivityExclusions";
import { useWoExclusions } from "@/hooks/useWoExclusions";
import { activityLabel, exclusionOverlapMs, lineDowntimeSecFromStops, mergeIntervals, toExclusionIntervals } from "@/lib/downtimeExclusions";
import { splitWoNotes, hasMeaningfulText } from "@/lib/woNotes";
import { DowntimeHistorySection } from "@/components/DowntimeHistorySection";
import { OperatorRecurrenceCard } from "@/components/OperatorRecurrenceCard";
import { RecurrenceBadge } from "@/components/RecurrenceBadge";
import { WoTimeline } from "@/components/WoTimeline";
import { StoppageRibbon } from "@/components/StoppageRibbon";
import { useDowntimeCorrections } from "@/hooks/useDowntimeCorrections";


const statusConfig: Record<string, { label: string; className: string }> = {
  open: { label: "Open", className: "bg-primary/10 text-primary border-primary/30 dark:bg-primary/15 dark:text-primary dark:border-primary/30" },
  received: { label: "Received", className: "bg-primary/10 text-primary border-primary/30 dark:bg-primary/15 dark:text-primary dark:border-primary/30" },
  arrived: { label: "Arrived", className: "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-500/15 dark:text-purple-300 dark:border-purple-500/30" },
  in_progress: { label: "In Progress", className: "bg-warning/10 text-warning-strong border-warning/30 dark:bg-warning/15 dark:text-warning-strong dark:border-warning/30" },
  finished: { label: "Finished", className: "bg-success/10 text-success-strong border-success/30 dark:bg-success/15 dark:text-success-strong dark:border-success/30" },
  closed: { label: "Closed", className: "bg-success/10 text-success-strong border-success/30 dark:bg-success/15 dark:text-success-strong dark:border-success/30" },
  completed: { label: "Completed", className: "bg-success/10 text-success-strong border-success/30 dark:bg-success/15 dark:text-success-strong dark:border-success/30" },
  force_closed: { label: "Force Closed", className: "bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-500/15 dark:text-gray-300 dark:border-gray-500/30" },
};

const priorityConfig: Record<string, { label: string; className: string }> = {
  low: { label: "Low", className: "bg-muted text-muted-foreground dark:bg-muted dark:text-muted-foreground dark:border-border" },
  medium: { label: "Medium", className: "bg-primary/10 text-primary dark:bg-primary/15 dark:text-primary dark:border-primary/30" },
  high: { label: "High", className: "bg-warning/10 text-warning-strong dark:bg-warning/15 dark:text-warning-strong dark:border-warning/30" },
  critical: { label: "Critical", className: "bg-destructive/10 text-destructive-strong dark:bg-destructive/15 dark:text-destructive-strong dark:border-destructive/30" },
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

import { formatDuration as formatDurationFromSec, formatMinutes } from "@/lib/formatDuration";
import { cycleTotal } from "@/lib/woCycle";

// Standardized: always "Xh Ym" (no seconds, no plain "min").
function formatDuration(minutes: number | null) {
  return formatMinutes(minutes);
}

function formatShortDuration(seconds: number) {
  const s = Math.max(0, Math.round(seconds || 0));
  // Preserve sub-minute stops (e.g. 18s quick resume) instead of rounding to "0h 0m".
  if (s > 0 && s < 60) return `0h 0m ${s}s`;
  return formatDurationFromSec(s);
}

function SignedPhoto({ storagePath, alt }: { storagePath: string; alt: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    getWOPhotoUrl(storagePath).then(setUrl);
  }, [storagePath]);
  if (!url) return <div className="aspect-square bg-muted rounded-lg animate-pulse" />;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative block overflow-hidden rounded-lg border bg-muted print:break-inside-avoid"
    >
      <img
        src={url}
        alt={alt}
        loading="lazy"
        className="aspect-square w-full object-cover transition-transform duration-200 group-hover:scale-105"
      />
      <div className="pointer-events-none absolute inset-0 flex items-end justify-end bg-gradient-to-t from-black/60 via-transparent to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100 print:hidden">
        <span className="rounded bg-background/90 px-2 py-1 text-xs font-medium text-foreground">View full</span>
      </div>
    </a>
  );
}


export default function WorkOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const { data: wo, isLoading } = useWorkOrderById(id!);
  // Asked only when the order failed to load, to tell "not yours" from "not there".
  const { data: accessHint } = useWorkOrderAccessHint(id!, !isLoading && !wo);
  const { data: partsUsed, isLoading: partsLoading } = usePartsUsedByWO(id!);
  const { data: woPhotos } = useWOPhotos(id!);
  const { data: checklistResponses } = useChecklistResponses(id);
  const { data: checklistItems } = useChecklistsByProblemName(wo?.description);
  const { data: downtimeEvents = [] } = useDowntimeEvents(id);
  const { data: woExclusions = [] } = useWoExclusions(id);
  const { data: woMetrics } = useWoMetrics(id);
  const { data: woCorrections = [] } = useDowntimeCorrections(id);

  const { data: woLogs } = useQuery({
    queryKey: ["work_order_logs", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_order_logs")
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
      // Admin-only RPC; column SELECT on profiles.labor_rate is revoked
      const { data, error } = await supabase.rpc("get_profile_labor_rate", {
        _user_id: wo!.engineer_id!,
      });
      if (error) throw error;
      return { labor_rate: Number(data) || 0 };
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

  // Opened with ?print=1 — from the printer button on a row in the orders list, so
  // printing one order is one click instead of open the tab, find the button, print.
  // Fires once, and only once the order and its photos are on the page.
  const wantsPrint = searchParams.get("print") === "1";
  const printedRef = useRef(false);
  useEffect(() => {
    if (!wantsPrint || !wo || printedRef.current) return;
    printedRef.current = true;
    const el = document.getElementById("wo-print-content");
    if (!el) return;
    // One tick so the cards below have laid out before the clone is taken.
    const t = window.setTimeout(() => {
      printElementAsDocument(el, `WO-${new Date(wo.created_at).getFullYear()}-${String(wo.wo_number).padStart(6, "0")}`)
        .catch((err) => toast.error(err?.message ?? "Could not open the print dialog."));
    }, 400);
    return () => window.clearTimeout(t);
  }, [wantsPrint, wo]);

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      </DashboardLayout>
    );
  }

  if (!wo) {
    // "Not found" was shown for two different situations, and the operator on Line 4
    // who opened Line 1's WO-607 was told the order did not exist. It does; it is
    // simply not theirs to open. Say which it is.
    const onAnotherLine = accessHint?.exists === true;
    return (
      <DashboardLayout>
        <div className="mx-auto max-w-md py-16 text-center space-y-3">
          <Lock className="mx-auto h-10 w-10 text-muted-foreground/60" />
          {onAnotherLine ? (
            <>
              <p className="font-medium text-foreground">
                WO-{String(accessHint?.wo_number ?? "").padStart(6, "0")} is on {accessHint?.line || "another line"}
              </p>
              <p className="text-sm text-muted-foreground">
                Your login only opens maintenance orders for your own line. Nothing is missing — ask a
                supervisor or the maintenance manager if you need this one.
              </p>
            </>
          ) : (
            <>
              <p className="font-medium text-foreground">This maintenance order does not exist</p>
              <p className="text-sm text-muted-foreground">
                The link may be from an old message, or the number may be mistyped.
              </p>
            </>
          )}
          <Button variant="link" onClick={() => navigate(-1)}>Go back</Button>
        </div>
      </DashboardLayout>
    );
  }

  const cfg = statusConfig[wo.status] || statusConfig.open;
  const pri = priorityConfig[wo.priority || "medium"] || priorityConfig.medium;
  // Warehouse service WOs never touch the production line → no downtime control / impact.
  const isWarehouseWO = (wo as any).wo_type === "warehouse_service";
  const woLabel = `WO-${new Date(wo.created_at).getFullYear()}-${String(wo.wo_number).padStart(6, "0")}`;

  // ── Metrics from v_wo_metrics view (single source of truth) ──────────
  // Falls back to inline math while the view is still loading or hasn't
  // captured the most recent transition.
  const acceptedAt = (wo as any).accepted_at || wo.received_at || wo.started_at;
  const secToMin = (s: number | null | undefined) =>
    typeof s === "number" && s >= 0 ? Math.round(s / 60) : null;

  const viewResponseMin = secToMin(woMetrics?.response_time_sec);
  const viewExecutionMin = secToMin(woMetrics?.active_repair_sec);
  const viewTotalMin = secToMin(woMetrics?.total_cycle_sec);

  const responseMin =
    viewResponseMin ??
    (acceptedAt ? differenceInMinutes(new Date(acceptedAt), new Date(wo.created_at)) : null);
  const executionMin =
    viewExecutionMin ??
    (wo.started_at && (wo.finished_at || wo.completed_at)
      ? differenceInMinutes(new Date(wo.finished_at || wo.completed_at!), new Date(wo.started_at))
      : null);
  // `v_wo_metrics.total_cycle_sec` is `closed_at - created_at`, which is a real
  // figure and not the one printed here. WO-2026-000511 read 362h 56m under the words
  // "opened → finished" for a fifty-five minute repair that waited fifteen days for a
  // signature. The view is left alone; this card stops borrowing from it.
  const cycle = cycleTotal(wo as any);
  const totalMin = cycle.minutes;

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-5xl xl:max-w-6xl mx-auto print:max-w-none print-content" id="wo-print-content">

        {/* ═══ PRINT-ONLY: Industrial Document Header ═══ */}
        <div className="hidden print:block mb-4">
          <div className="border-b-2 border-black pb-3 flex items-end justify-between gap-4">
            <div className="flex items-end gap-3">
              <img src="/appliedlogo.jpeg" alt="Applied Nutrition" crossOrigin="anonymous" className="h-14 w-auto object-contain" onError={(e) => (e.currentTarget.style.display = 'none')} />
              {/* The sheet used to carry a logo and nothing else, so a print where the
                  image failed to load came out of the printer unidentifiable. */}
              <div>
                <p className="text-[13pt] font-bold uppercase tracking-wide leading-none">Maintenance Order</p>
                <p className="text-[8pt] text-gray-600 mt-0.5">Applied Nutrition</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-base font-bold font-mono">{woLabel}</p>
              <p className="text-[8pt] text-gray-600">Opened {format(new Date(wo.created_at), "dd/MM/yyyy HH:mm")}</p>
            </div>
          </div>
          {/* Document metadata row */}
          <div className="grid grid-cols-5 border border-black border-t-0 text-[8pt]">
            <div className="border-r border-black px-2 py-1"><span className="font-bold">Priority:</span> {pri.label}</div>
            <div className="border-r border-black px-2 py-1"><span className="font-bold">Status:</span> {cfg.label}</div>
            <div className="border-r border-black px-2 py-1"><span className="font-bold">Line:</span> {(wo as any).line_at_time || "—"}</div>
            <div className="border-r border-black px-2 py-1"><span className="font-bold">Machine:</span> {wo.machine || "—"}</div>
            <div className="px-2 py-1"><span className="font-bold">Requester:</span> {wo.requester_name}</div>
          </div>
        </div>

        {/* Screen-only navigation */}
        {/* Back moved to the shell header, where every screen has it. */}
        <div className="flex items-center justify-end print:hidden">
          <div className="flex gap-2">
            {(role === "admin" || (role === "manager" || role === "maintenance_manager")) && (
              <>
                <Button variant="outline" size="sm" onClick={async () => {
                  const el = document.getElementById("wo-print-content");
                  if (!el) { toast.error("Nothing to print yet — the order is still loading."); return; }
                  try {
                    await printElementAsDocument(el, woLabel);
                  } catch (err: any) {
                    toast.error(err?.message ?? "Could not open the print dialog.");
                  }
                }} className="gap-2">
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
              </>
            )}
          </div>
        </div>

        {/* Order bar — the reference, where it is, and its state, kept in view.
            Scrolling past the header used to leave the page anonymous. */}
        <div className="sticky top-0 z-20 -mx-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-background/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80 print:hidden md:-mx-6 md:px-6">
          <span className="font-figure text-sm font-semibold tabular-nums">{woLabel}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
            {(wo as any).wo_type === "warehouse_service"
              ? `Warehouse · ${(wo as any).warehouse_location || "—"}`
              : ([((wo as any).line_at_time), wo.machine].filter(Boolean).join(" · ") || "—")}
          </span>
          <Badge variant="outline" className={`shrink-0 ${cfg.className}`}>{cfg.label}</Badge>
          <Badge variant="outline" className={`shrink-0 ${pri.className}`}>{pri.label}</Badge>
        </div>

        {/* Screen-only title with badges.
            A ordem estava ao contrário. O topo a 24 px era o nome de quem abriu a
            ordem, e a referência — o que identifica esta página, o que se diz em voz
            alta na linha e o que se escreve na caixa de pesquisa — estava em cinzento
            pequeno na terceira linha. Quem chega aqui por uma notificação precisa de
            confirmar QUE ordem é antes de saber de quem veio.
            Agora a referência é o título, em Plex Mono porque é um código; a linha e a
            máquina dizem onde é; e o requerente desce para onde os outros campos estão.
            Uma página de detalhe não usa o `PageHeader` de propósito: aquele nomeia uma
            secção, este nomeia um registo, e carrega estado ao vivo. */}
        <div className="flex items-start justify-between gap-4 print:hidden">
          <div className="flex flex-col min-w-0 flex-1">
            <div className="mb-1 font-display text-[11px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
              Maintenance · Work order
            </div>
            <h2 className="truncate font-figure text-[27px] font-semibold leading-tight tracking-tight" title={woLabel}>
              {woLabel}
            </h2>
            <p className="mt-1 truncate text-base text-muted-foreground" title={wo.machine || (wo as any).line_at_time || ""}>
              {(wo as any).wo_type === "warehouse_service"
                ? `Warehouse · ${(wo as any).warehouse_location || "—"}`
                : ([((wo as any).line_at_time), wo.machine].filter(Boolean).join(" · ") || "—")}
            </p>
            <div className="flex items-center gap-2 flex-wrap mt-2">
              <p className="truncate text-sm text-muted-foreground" title={wo.requester_name}>
                Raised by {wo.requester_name}
              </p>
              {(wo as any).wo_type === "warehouse_service" && (
                <Badge variant="outline" className="text-sm px-3 py-1 bg-primary/15 text-primary border-primary/30" title="Warehouse service — not counted as line downtime or OEE loss">Warehouse</Badge>
              )}
              <RecurrenceBadge originalWoId={(wo as any).recurrence_of_wo_id} />
              {((wo as any).current_episode ?? 1) > 1 && (
                <Badge variant="outline" className="text-sm px-3 py-1 border-warning text-warning-strong bg-warning/10 dark:bg-warning/30">
                  🔁 Episode {(wo as any).current_episode}
                  {((wo as any).reopen_count ?? 0) > 0 && ` · reopened ${(wo as any).reopen_count}×`}
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* Production Line Status — multi-cycle stop/resume control (not for warehouse WOs) */}
        {!isWarehouseWO && (
          <div className="print:hidden">
            {/* The live control vanishes once the order is finished, so an order that
                was worked without anybody ticking "line stopped" had no way back —
                the downtime simply never existed. This is that way back. */}
            {["finished", "closed", "completed"].includes(wo.status) && (
              <div className="mb-2">
                <RecordMissedDowntime
                  workOrderId={wo.id}
                  woNumber={wo.wo_number}
                  problem={wo.description}
                  createdAt={(wo as any).line_stopped_at ?? wo.created_at}
                  finishedAt={(wo as any).finished_at ?? (wo as any).closed_at ?? null}
                />
              </div>
            )}
            <LineDowntimeControl
              workOrderId={wo.id}
              problem={wo.description}
              workOrderStatus={wo.status}
              operatorId={(wo as any).operator_id}
              engineerId={(wo as any).engineer_id}
              lineId={(wo as any).line_id}
              requesterName={wo.requester_name}
            />
            <div className="mt-2">
              <TeamActivityExclusions
                workOrderId={wo.id}
                lineStopped={
                  !!((wo as any).line_stopped && !(wo as any).line_resumed_at) ||
                  downtimeEvents.some((e) => !e.resumed_at)
                }
              />
            </div>
          </div>
        )}

        {/* Lifecycle Timeline — labeled durations from v_wo_metrics (single source of truth) */}
        <div className="print:hidden">
          <WoTimeline workOrderId={wo.id} />
        </div>

        {/* Operator: report a recurring failure on a finished/closed WO */}
        <OperatorRecurrenceCard wo={wo as any} />

        {/* Problem — what was reported, and why the line stopped. */}
        <Card className="print:border print:border-black print:shadow-none print:rounded-none">
          <CardHeader className="print:pb-1 print:pt-2"><CardTitle className="text-base print:text-sm print:font-bold">Problem</CardTitle></CardHeader>
          <CardContent className="print:pb-2 space-y-2">
            <p className="print:text-[9pt]">{wo.description}</p>
            {(() => {
              const reason = downtimeEvents.find((e) => hasMeaningfulText(e.stopped_reason))?.stopped_reason;
              if (!reason) return null;
              return (
                <p className="text-sm text-muted-foreground print:text-[8pt]">
                  Line stopped — {reason}
                </p>
              );
            })()}
          </CardContent>
        </Card>

        {/* Resolution — the engineer's own note, said once, here only. */}
        {(() => {
          const { human, machine } = splitWoNotes(wo.notes);
          const written = hasMeaningfulText(human);
          return (
            <Card className="print:border print:border-black print:shadow-none print:rounded-none">
              <CardHeader className="print:pb-1 print:pt-2"><CardTitle className="text-base print:text-sm print:font-bold">Resolution</CardTitle></CardHeader>
              <CardContent className="space-y-2 print:pb-2">
                {written ? (
                  <p className="whitespace-pre-line print:text-[9pt]">{human}</p>
                ) : (
                  /* A lone comma is not an observation. */
                  <p className="text-sm text-muted-foreground print:text-[8pt]">No observations recorded</p>
                )}
                {machine && (
                  /* Kept, not deleted: it is the automatic trail of how the order came
                     to exist. Folded away because every fact in it is already shown
                     somewhere a person can read. */
                  <details className="text-xs text-muted-foreground print:hidden">
                    <summary className="cursor-pointer select-none">Automatic log from iTouching</summary>
                    <p className="mt-1 whitespace-pre-line">{machine}</p>
                  </details>
                )}
              </CardContent>
            </Card>
          );
        })()}

        {/* Metadata strip — the print header's own shape, said once (screen only). */}
        <div className="flex flex-wrap rounded-lg border border-border bg-card print:hidden">
          {[
            { label: "Priority", value: pri.label },
            { label: "Status", value: cfg.label },
            { label: "Line", value: (wo as any).line_at_time || "—" },
            { label: "Machine", value: wo.machine || "—" },
            { label: "Requester", value: wo.requester_name || "—" },
            { label: "Engineer", value: wo.engineer_name || wo.engineer?.name || "—" },
          ].map((f) => (
            <div
              key={f.label}
              className="min-w-[9rem] flex-1 border-b border-r border-border px-4 py-3 last:border-r-0 [&:nth-child(2n)]:border-r-0 sm:[&:nth-child(2n)]:border-r md:[&:nth-child(3n)]:border-r-0 lg:[&:nth-child(3n)]:border-r"
            >
              <p className="text-2xs uppercase tracking-wide text-muted-foreground">{f.label}</p>
              <p className="mt-0.5 text-sm font-medium" title={f.value}>{f.value}</p>
            </div>
          ))}
        </div>

        {/* Personnel — "Signed By" removed (operator signature is in footer) */}
        {/* Screen shows these once, in the metadata strip above. Print keeps the boxes. */}
        <div className="hidden print:grid gap-4 md:grid-cols-3 print:grid-cols-3 print:gap-0">
          <Card className="print:border print:border-black print:shadow-none print:rounded-none"><CardContent className="pt-6 print:pt-1 print:pb-1"><p className="text-sm text-muted-foreground print:text-[7pt] print:font-bold">Requested By</p><p className="font-medium print:text-[9pt]">{wo.requester_name}</p></CardContent></Card>
          <Card className="print:border print:border-black print:shadow-none print:rounded-none"><CardContent className="pt-6 print:pt-1 print:pb-1"><p className="text-sm text-muted-foreground print:text-[7pt] print:font-bold">Engineer</p><p className="font-medium print:text-[9pt]">{wo.engineer_name || wo.engineer?.name || ""}</p></CardContent></Card>
          {wo.closer?.name && <Card className="print:border print:border-black print:shadow-none print:rounded-none"><CardContent className="pt-6 print:pt-1 print:pb-1"><p className="text-sm text-muted-foreground print:text-[7pt] print:font-bold">Closed By</p><p className="font-medium print:text-[9pt]">{wo.closer.name}</p></CardContent></Card>}
        </div>

        {/* ATTENDANCE TIMES */}
        <Card className="print:border print:border-black print:shadow-none print:rounded-none print:break-inside-avoid">
          <CardHeader className="print:pb-1 print:pt-2 pb-3"><CardTitle className="text-xs uppercase tracking-wider text-muted-foreground print:text-[8pt] print:font-bold print:text-black">Attendance Times</CardTitle></CardHeader>
          <CardContent className="print:pt-0">
            <div className="grid grid-cols-3 gap-4 print:gap-0">
              <div className="text-center print:border print:border-black print:py-2">
                <p className="text-2xs uppercase tracking-wide text-muted-foreground print:text-[7pt] print:font-bold print:text-black">Response</p>
                <p className="mt-1 font-figure text-3xl font-semibold tabular-nums print:text-base">{formatDuration(responseMin)}</p>
                <p className="mt-1 text-2xs text-muted-foreground print:text-[6pt]">
                  opened {format(new Date(wo.created_at), "HH:mm")}
                  {acceptedAt ? ` → accepted ${format(new Date(acceptedAt), "HH:mm")}` : " → not accepted yet"}
                </p>
              </div>
              <div className="text-center print:border print:border-l-0 print:border-black print:py-2">
                <p className="text-2xs uppercase tracking-wide text-muted-foreground print:text-[7pt] print:font-bold print:text-black">Execution</p>
                <p className="mt-1 font-figure text-3xl font-semibold tabular-nums print:text-base">{formatDuration(executionMin)}</p>
                <p className="mt-1 text-2xs text-muted-foreground print:text-[6pt]">
                  {wo.started_at ? `start ${format(new Date(wo.started_at), "HH:mm")}` : "not started"}
                  {(wo.finished_at || wo.completed_at) ? ` → finish ${format(new Date(wo.finished_at || wo.completed_at!), "HH:mm")}` : " → open"}
                </p>
              </div>
              <div className="text-center print:border print:border-l-0 print:border-black print:py-2">
                <p className="text-2xs uppercase tracking-wide text-muted-foreground print:text-[7pt] print:font-bold print:text-black">Total Time</p>
                <p className="mt-1 font-figure text-3xl font-semibold tabular-nums print:text-base">{formatDuration(totalMin)}</p>
                <p className="mt-1 text-2xs text-muted-foreground print:text-[6pt]">{cycle.label}</p>
                {/* The wait for a signature, said as its own thing. Fifteen days is a
                    real problem and not a maintenance one; inside the repair figure it
                    was arithmetic nobody could reconcile. */}
                {cycle.signOffWaitMinutes != null && (
                  <p className="mt-1 text-2xs text-warning-strong print:text-[6pt]">
                    + {formatDuration(cycle.signOffWaitMinutes)} waiting for sign-off
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* PRODUCTION IMPACT (not for warehouse WOs — they never stop the line) */}
        {!isWarehouseWO && (() => {
          // Operator-declared downtime: starts when WO is created with line_stopped=true,
          // ends only when the operator signs/closes the WO (line_resumed_at).
          const operatorStopStart = (wo as any).line_stopped_at || null;
          const operatorStopEnd = (wo as any).line_resumed_at || null;
          const hasOperatorStop = !!operatorStopStart;
          const operatorDowntimeSec = hasOperatorStop
            ? Math.max(0, differenceInSeconds(new Date(operatorStopEnd || new Date()), new Date(operatorStopStart)))
            : 0;

          // The operator's stop and the first event are the same stoppage.
          //
          // `wo_auto_insert_downtime_event` writes an event FROM `line_stopped_at`, so
          // adding the two counted one stoppage twice. The events are the record, and
          // overlapping events are the same minutes: they are merged, never summed —
          // WO-824 has a 48-minute stop recorded on top of a 287-minute one and read
          // 4h 43m here against 4h 16m in the timeline above it.
          //
          // The order's own timestamps stay the fallback for orders with no event.
          const useEvents = downtimeEvents.length > 0;
          const stopCount = useEvents ? downtimeEvents.length : (hasOperatorStop ? 1 : 0);
          // Team-activity exclusions (break / filling blender / brushing & cleaning)
          // are subtracted from the merged spans; the raw records stay intact.
          const exclusionIvs = toExclusionIntervals(woExclusions);
          const mergedSpans = useEvents
            ? mergeIntervals(
                downtimeEvents
                  .map((e) => [
                    new Date(e.stopped_at).getTime(),
                    e.resumed_at ? new Date(e.resumed_at).getTime() : Date.now(),
                  ] as [number, number])
                  .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s),
              )
            : hasOperatorStop
              ? mergeIntervals([[
                  new Date(operatorStopStart).getTime(),
                  new Date(operatorStopEnd || new Date()).getTime(),
                ]])
              : [];
          const excludedMin = Math.round(
            mergedSpans.reduce((ms, [s, e]) => ms + exclusionOverlapMs(s, e, exclusionIvs), 0) / 60000,
          );
          const totalDowntimeSec = useEvents
            ? (lineDowntimeSecFromStops(downtimeEvents, woExclusions, operatorDowntimeSec) ?? 0)
            : Math.max(0, operatorDowntimeSec - excludedMin * 60);

          const lineOperating = !((wo as any).line_stopped && !(wo as any).line_resumed_at);
          const spanLabel = mergedSpans.length
            ? `${format(new Date(mergedSpans[0][0]), "HH:mm")} → ${format(new Date(mergedSpans[mergedSpans.length - 1][1]), "HH:mm")}`
            : null;
          const exclusionLabels = (woExclusions || [])
            .filter((x: any) => x.started_at)
            .map((x: any) => ({
              start: new Date(x.started_at).getTime(),
              end: x.ended_at ? new Date(x.ended_at).getTime() : Date.now(),
              label: activityLabel(x.activity),
            }))
            .filter((x) => x.end > x.start);
          const correctionMarks = (woCorrections || [])
            .map((c) => new Date(c.new_stopped_at).getTime())
            .filter((t) => Number.isFinite(t));
          return (
            <Card className="print:border print:border-black print:shadow-none print:rounded-none print:break-inside-avoid">
              <CardHeader className="print:pb-1 print:pt-2 pb-3"><CardTitle className="text-xs uppercase tracking-wider text-muted-foreground print:text-[8pt] print:font-bold print:text-black">Production Impact</CardTitle></CardHeader>
              <CardContent className="print:pt-0">
                <div className="grid grid-cols-3 gap-4 print:gap-0">
                  <div className="text-center print:border print:border-black print:py-2">
                    <p className="text-2xs uppercase tracking-wide text-muted-foreground print:text-[7pt] print:font-bold print:text-black">Line Status</p>
                    <p className={`mt-1 text-2xl font-bold flex items-center justify-center gap-1 print:text-base ${lineOperating ? "text-success-strong" : "text-destructive-strong"}`}>
                      {lineOperating ? <><CheckCircle className="h-5 w-5 print:hidden" /> Running</> : <><AlertOctagon className="h-5 w-5 print:hidden" /> Stopped</>}
                    </p>
                    <p className="mt-1 text-2xs text-muted-foreground print:text-[6pt]">at closure</p>
                  </div>
                  <div className="text-center print:border print:border-l-0 print:border-black print:py-2">
                    <p className="text-2xs uppercase tracking-wide text-muted-foreground print:text-[7pt] print:font-bold print:text-black">Stoppages</p>
                    <p className="mt-1 font-figure text-3xl font-semibold tabular-nums print:text-base">{stopCount}</p>
                    <p className="mt-1 text-2xs text-muted-foreground print:text-[6pt]">recorded</p>
                  </div>
                  <div className="text-center print:border print:border-l-0 print:border-black print:py-2">
                    <p className="text-2xs uppercase tracking-wide text-muted-foreground print:text-[7pt] print:font-bold print:text-black">Total Downtime</p>
                    <p className="mt-1 font-figure text-3xl font-semibold tabular-nums print:text-base">{stopCount === 0 ? "—" : formatShortDuration(totalDowntimeSec)}</p>
                    <p className="mt-1 text-2xs text-muted-foreground print:text-[6pt]">{spanLabel ?? "stoppage time"}</p>
                    {excludedMin > 0 && (<p className="text-2xs text-muted-foreground print:text-[6pt]">{excludedMin} min excluded — team activity</p>)}
                  </div>
                </div>

                {/* The order's clock, to scale — same merged spans as the figure above. */}
                {mergedSpans.length > 0 && (
                  <div className="mt-5 border-t pt-4 print:hidden">
                    <StoppageRibbon
                      spans={mergedSpans}
                      exclusions={exclusionIvs}
                      corrections={correctionMarks}
                      exclusionLabels={exclusionLabels}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })()}

        {/* TIMELINE — vertical, deduped (one row per real event) */}
        <Card className="print:border print:border-black print:shadow-none print:rounded-none print:break-inside-avoid">
          <CardHeader className="print:pb-1 print:pt-2 pb-3"><CardTitle className="text-xs uppercase tracking-wider text-muted-foreground print:text-[8pt] print:font-bold print:text-black">Timeline</CardTitle></CardHeader>
          <CardContent>
            {(() => {
              type Ev = { ts: string; icon: "open" | "stop" | "resume" | "done" | "force" | "pause"; title: string; sub?: string; delta?: string };
              const evs: Ev[] = [];
              const created = new Date(wo.created_at);
              evs.push({ ts: wo.created_at, icon: "open", title: "Order created", sub: `by ${wo.requester_name} (operator)` });
              if (acceptedAt) {
                const dMin = differenceInMinutes(new Date(acceptedAt), created);
                evs.push({ ts: acceptedAt, icon: "open", title: "Order accepted (PIN ✓)", sub: `by ${wo.engineer_name || "—"}`, delta: dMin > 0 ? `${dMin}min after opening` : undefined });
              }
              if (wo.started_at && wo.started_at !== acceptedAt) {
                evs.push({ ts: wo.started_at, icon: "open", title: "Work started", sub: `by ${wo.engineer_name || "—"}` });
              }
              downtimeEvents.forEach((d) => {
                evs.push({ ts: d.stopped_at, icon: "stop", title: "Line marked as stopped", sub: `by ${d.stopped_by_name || "—"}${d.stopped_reason ? ` — reason: "${d.stopped_reason}"` : ""}` });
                if (d.resumed_at) {
                  const dur = formatShortDuration(differenceInSeconds(new Date(d.resumed_at), new Date(d.stopped_at)));
                  evs.push({ ts: d.resumed_at, icon: "resume", title: "Line back to running", sub: `by ${d.resumed_by_name || "—"} — stoppage: ${dur}` });
                }
              });
              // Team activity — break, blending, cleaning — belongs on the record of
              // the order, not only in the arithmetic that subtracts it. Whoever reads
              // the printed order should see why the stoppage was shorter than the gap
              // between the two timestamps around it.
              woExclusions.forEach((x) => {
                const who = x.source === "intouch" ? "reported by iTouching" : `by ${x.started_by_name || "—"}`;
                evs.push({
                  ts: x.started_at,
                  icon: "pause",
                  title: `Line team on ${activityLabel(x.activity).toLowerCase()}`,
                  sub: `${who} — not counted as downtime`,
                });
                if (x.ended_at) {
                  const mins = differenceInMinutes(new Date(x.ended_at), new Date(x.started_at));
                  evs.push({
                    ts: x.ended_at,
                    icon: "resume",
                    title: "Back to the stoppage",
                    sub: `${activityLabel(x.activity)} — ${mins}min excluded`,
                  });
                }
              });
              if (wo.finished_at) evs.push({ ts: wo.finished_at, icon: "done", title: "Finished (PIN ✓)", sub: `by ${wo.engineer_name || "—"}` });
              if (wo.closed_at) evs.push({ ts: wo.closed_at, icon: "done", title: "Closed", sub: wo.closer?.name ? `by ${wo.closer.name}` : undefined });
              if (wo.status === "force_closed" && wo.completed_at) evs.push({ ts: wo.completed_at, icon: "force", title: "Force closed", sub: wo.closer?.name ? `by ${wo.closer.name}` : undefined });
              evs.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
              const iconFor = (i: Ev["icon"]) => {
                if (i === "stop") return <span className="text-destructive-strong">🛑</span>;
                if (i === "pause") return <span className="text-warning-strong">⏸</span>;
                if (i === "resume") return <span className="text-success-strong">✓</span>;
                if (i === "force") return <span className="text-muted-foreground">✕</span>;
                return <span className="text-primary">●</span>;
              };
              return (
                <ol className="relative border-l border-border pl-5 space-y-4 print:space-y-2">
                  {evs.map((e, i) => (
                    <li key={i} className="text-sm print:text-[8pt]">
                      <div className="flex items-baseline gap-2">
                        <span className="-ml-7 w-5 text-center inline-block">{iconFor(e.icon)}</span>
                        <span className="font-figure text-xs print:text-[7pt] text-muted-foreground">{format(new Date(e.ts), "dd/MM HH:mm:ss")}</span>
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

        {/* Line stoppage history is rendered below by DowntimeHistorySection */}

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
                                {done ? <CheckSquare className="h-4 w-4 text-success-strong mt-0.5 print:h-3 print:w-3" /> : <Square className="h-4 w-4 text-muted-foreground mt-0.5 print:h-3 print:w-3" />}
                                <div>
                                  <span>{it.description}{it.is_required && <span className="text-destructive-strong ml-1">*</span>}</span>
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
                    <p className="text-xs print:text-[7pt] font-medium pt-2 border-t border-border mt-2">STATUS: {requiredDone}/{required.length} required items completed {requiredDone === required.length && required.length > 0 ? "✓" : ""}</p>
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        )}

        {/* Multi-cycle line stop / resume history with date & user filters */}
        <DowntimeHistorySection workOrderId={wo.id} />

        {/* Parts Used */}
        <Card className="print:border print:border-black print:shadow-none print:rounded-none">
          <CardHeader className="print:pb-1 print:pt-2"><CardTitle className="text-base print:text-sm print:font-bold">Parts Used</CardTitle></CardHeader>
          <CardContent>
            {partsLoading ? (
              <div className="flex justify-center py-4 print:hidden"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : !partsUsed?.length ? (
              <p className="text-muted-foreground text-sm print:text-[8pt]">No parts registered for this maintenance order.</p>
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
        <Card className="print:border print:border-black print:shadow-none print:rounded-none">
          <CardHeader className="print:pb-1 print:pt-2">
            <CardTitle className="text-base print:text-sm print:font-bold flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <Camera className="h-4 w-4 print:hidden" /> Photos
              </span>
              {woPhotos && woPhotos.length > 0 && (
                <span className="text-xs font-normal text-muted-foreground print:hidden">
                  {woPhotos.length} photo{woPhotos.length === 1 ? "" : "s"}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 md:grid-cols-2 print:grid-cols-2 print:gap-2">
              {(["before", "after"] as const).map((type) => {
                const photos = (woPhotos || []).filter((p) => p.photo_type === type);
                return (
                  <div key={type}>
                    <p className="text-sm font-medium mb-2 capitalize print:text-[8pt] print:font-bold flex items-center justify-between">
                      <span>{type}</span>
                      {photos.length > 0 && (
                        <span className="text-xs font-normal text-muted-foreground print:hidden">×{photos.length}</span>
                      )}
                    </p>
                    {photos.length ? (
                      <div className={photos.length > 1 ? "grid grid-cols-2 gap-2" : "grid gap-2"}>
                        {photos.map((p) => (
                          <SignedPhoto key={p.id} storagePath={p.storage_path} alt={`${type} photo`} />
                        ))}
                      </div>
                    ) : (
                      <div className="flex aspect-square items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/30 bg-muted/20 print:hidden">
                        <div className="text-center text-muted-foreground">
                          <Camera className="mx-auto h-8 w-8 opacity-40" />
                          <p className="mt-2 text-xs">No {type} photo</p>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>


        {/* Cost Breakdown - hidden in print, admin only */}
        {costBreakdown && costBreakdown.totalCost > 0 && (
          <Card className="print:hidden">
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><DollarSign className="h-4 w-4" /> Cost Breakdown</CardTitle></CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-4">
                <div><p className="text-sm text-muted-foreground">Parts Cost</p><p className="text-xl font-bold">£{costBreakdown.partsCost.toFixed(2)}</p></div>
                <div><p className="text-sm text-muted-foreground">Labor Cost ({costBreakdown.repairHours}h)</p><p className="text-xl font-bold">£{costBreakdown.laborCost.toFixed(2)}</p></div>
                <div><p className="text-sm text-muted-foreground">Overtime</p><p className="text-xl font-bold">{costBreakdown.overtimeCost > 0 ? <span className="text-destructive-strong">£{costBreakdown.overtimeCost.toFixed(2)}</span> : "—"}</p></div>
                <div><p className="text-sm text-muted-foreground">Total Cost</p><p className="text-2xl font-bold text-primary">£{costBreakdown.totalCost.toFixed(2)}</p></div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ═══ PRINT-ONLY: Formal Signature Section ═══ */}
        <div className="hidden print:block mt-4 pt-2 border-t-2 border-black">
          <div className="grid grid-cols-2 gap-12">
            <div>
              <p className="text-[8pt] font-bold mb-1">Engineer Signature:</p>
              <p className="text-[8pt] mb-1">Name: <span className="font-medium">{wo.engineer_name || wo.engineer?.name || ""}</span></p>
              <p className="text-[8pt] mb-4">Date: {wo.started_at ? format(new Date(wo.started_at), "dd/MM/yyyy") : ""}</p>
              <div className="border-b-2 border-black w-full" />
              <p className="text-[7pt] mt-1 text-gray-500">Signature</p>
            </div>
            <div>
              <p className="text-[8pt] font-bold mb-1">Operator Signature:</p>
              <p className="text-[8pt] mb-1">Name: <span className="font-medium">{wo.requester_name || wo.operator?.name || ""}</span></p>
              <p className="text-[8pt] mb-4">Date: {format(new Date(wo.created_at), "dd/MM/yyyy")}</p>
              <div className="border-b-2 border-black w-full" />
              <p className="text-[7pt] mt-1 text-gray-500">Signature</p>
            </div>
          </div>
          <div className="print-doc-footer mt-3 pt-1 border-t border-gray-400 flex items-center justify-between text-[7pt] text-gray-600">
            <span>{woLabel} · {wo.machine || (wo as any).warehouse_location || "—"}</span>
            <span>Applied Nutrition · Confidential · printed {format(new Date(), "dd/MM/yyyy HH:mm")}</span>
          </div>
        </div>

      </div>
    </DashboardLayout>
  );
}
