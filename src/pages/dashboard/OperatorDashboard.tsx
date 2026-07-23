import { useState, useMemo } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { ClipboardList, Plus, Loader2, AlertTriangle, Clock, CalendarIcon, CheckCircle, Zap, StopCircle, AlertCircle, Factory, Printer } from "lucide-react";
import { useWorkOrders, useCreateWorkOrder, useCloseWorkOrder } from "@/hooks/useWorkOrders";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { usePartsCountByWOs } from "@/hooks/useStock";
import { useMachines, useLines } from "@/hooks/useMachines";
import { useMobileAssets, formatMobileAsset } from "@/hooks/useMobileAssets";
import { MobileAssetSubPicker } from "@/components/MobileAssetSubPicker";
import { useActiveProblemsForLine } from "@/hooks/useLineProblemDescriptions";

import { OperatorLineGuard } from "@/components/OperatorLineGuard";
import { useDeviceLineCtx } from "@/contexts/DeviceLineContext";
import { useToast } from "@/hooks/use-toast";
import { toast as sonnerToast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, Navigate } from "react-router-dom";
import { format, differenceInDays, subDays } from "date-fns";
import { cn } from "@/lib/utils";
import { RecurrenceBadge } from "@/components/RecurrenceBadge";
import { OperatorNavCards } from "@/components/DashboardNavCards";

import { countOpenWOs } from "@/lib/woStatus";
import { getShift, SHIFT_LABEL, getCurrentShiftStart, getCurrentFactoryShift, type ShiftCode } from "@/lib/shifts";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip, Legend } from "recharts";


import { woStatusConfig as statusConfig, priorityChipClass } from "@/lib/woStatusConfig";


export default function OperatorDashboard() {
  const { role, loading: authLoading } = useAuth();

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }
  // ProtectedRoute already enforces role access; if role is missing transiently, just wait
  if (!role) return null;
  // Non-operators (e.g. an admin opening this route directly) get a clear
  // message instead of a blank/black screen.
  if (role !== "operator") {
    return (
      <DashboardLayout>
        <div className="flex min-h-[60vh] items-center justify-center p-6">
          <div className="max-w-md space-y-3 text-center">
            <Factory className="mx-auto h-12 w-12 text-muted-foreground" />
            <h1 className="text-xl font-semibold text-foreground">Operator panel</h1>
            <p className="text-sm text-muted-foreground">
              This screen is used by operators on the line to log production and raise maintenance
              requests. Your account isn't an operator, so there's nothing to show here — use your
              own dashboard from the menu.
            </p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <OperatorLineGuard>
        <OperatorDashboardContent />
      </OperatorLineGuard>
    </DashboardLayout>
  );
}

function OperatorDashboardContent() {
  // Allowed lines are bound to the device; operator may switch among them via the guard banner.
  const { selectedLineId: lineId, selectedLineName: lineName } = useDeviceLineCtx();

  const [mobileAssetId, setMobileAssetId] = useState<string>(""); // sealer
  const [secondaryAssetId, setSecondaryAssetId] = useState<string>(""); // printer
  const [physicalLineId, setPhysicalLineId] = useState<string>(""); // real production line where the sealer/printer is being used
  const [description, setDescription] = useState("");
  const [customDescription, setCustomDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [requestedBy, setRequestedBy] = useState("");
  const [machineName, setMachineName] = useState<string>(""); // optional, regular lines only
  const [lineStopped, setLineStopped] = useState(false);
  const [isRetroactive, setIsRetroactive] = useState(false);
  const [retroDate, setRetroDate] = useState<Date>();
  const [retroTime, setRetroTime] = useState("");
  const [shiftFilter, setShiftFilter] = useState<"all" | ShiftCode>("all");

  // Tablet is paired (guard guarantees lineId) — always scope to this line.
  const { data: workOrders, isLoading } = useWorkOrders({ lineId });
  const { data: allWOs } = useWorkOrders({ lineId });
  // Operators only see the CURRENT factory shift's orders — previous shifts drop off automatically.
  const shiftWOs = (workOrders ?? []).filter((wo) => new Date(wo.created_at) >= getCurrentShiftStart());
  const woIds = workOrders?.map((wo) => wo.id) || [];
  const { data: partsCounts } = usePartsCountByWOs(woIds);
  const { data: machines } = useMachines();
  const { data: lines } = useLines();
  const { data: mobileAssets } = useMobileAssets();
  const { data: problemDescriptions } = useActiveProblemsForLine(lineId);
  
  const createWO = useCreateWorkOrder();
  const closeWO = useCloseWorkOrder();
  const { toast } = useToast();
  const qcRef = useQueryClient();
  const navigate = useNavigate();

  // Operator close — no signature dialog; uses requester or operator profile name as signature
  const handleQuickClose = async (woId: string, fallbackRequester: string | null) => {
    const sig = (fallbackRequester?.trim() || "Operator").slice(0, 100);
    try {
      await closeWO.mutateAsync({ woId, signatureName: sig });
      toast({ title: "Work Order Closed", description: "The work order has been closed." });
    } catch {
      toast({ title: "Error", description: "Failed to close work order", variant: "destructive" });
    }
  };

  // Detect Sealer/Printer line by name to pre-select the asset sub-picker mode.
  const lineIsSealerPrinter = useMemo(
    () => /sealer|printer/i.test(lineName || ""),
    [lineName]
  );
  // Operator can manually switch any login between "Line" WO and "Sealer/Printer Ink" WO.
  const [targetMode, setTargetMode] = useState<"line" | "sealer_printer">(
    lineIsSealerPrinter ? "sealer_printer" : "line"
  );
  // Keep mode in sync when the operator switches the bound line.
  useMemo(() => {
    setTargetMode(lineIsSealerPrinter ? "sealer_printer" : "line");
  }, [lineIsSealerPrinter]);
  const isSealerPrinterLine = targetMode === "sealer_printer";

  // Smart suggestions: recent WOs for the locked line
  const machineSuggestions = useMemo(() => {
    if (!lineName || !allWOs) return null;
    const lineWOs = allWOs.filter((w) => (w as any).line_at_time === lineName);
    if (!lineWOs.length) return null;
    const lastWO = lineWOs[0];
    const daysSinceLast = differenceInDays(new Date(), new Date(lastWO.created_at));
    const problemCount: Record<string, number> = {};
    lineWOs.forEach((w) => { problemCount[w.description] = (problemCount[w.description] || 0) + 1; });
    const topProblems = Object.entries(problemCount).sort((a, b) => b[1] - a[1]).slice(0, 3);
    return { totalWOs: lineWOs.length, daysSinceLast, topProblems };
  }, [lineName, allWOs]);

  // Auto-priority based on history
  const autoPriority = useMemo(() => {
    if (!lineName || !description || !allWOs) return { priority: "medium" as string, reason: "" };
    const cutoff7 = subDays(new Date(), 7).toISOString();
    const cutoff5 = subDays(new Date(), 5).toISOString();

    const recent7d = allWOs.filter((w) => (w as any).line_at_time === lineName && w.description === description && w.created_at >= cutoff7);
    if (recent7d.length >= 3) {
      return { priority: "high", reason: `Recurring issue: ${recent7d.length}x in the last 7 days` };
    }

    const recentRepair = allWOs.find((w) => (w as any).line_at_time === lineName && w.finished_at && w.finished_at >= cutoff5);
    if (recentRepair) {
      return { priority: "high", reason: "Recent repair on this line (< 5 days)" };
    }

    const cutoff30 = subDays(new Date(), 30).toISOString();
    const repeated30d = allWOs.filter((w) => (w as any).line_at_time === lineName && w.description === description && w.created_at >= cutoff30);
    if (repeated30d.length >= 2) {
      return { priority: "medium", reason: `Repeated issue: ${repeated30d.length}x in 30 days` };
    }

    return { priority: "low", reason: "First occurrence — low priority" };
  }, [lineName, description, allWOs]);

  // AI insights
  const aiInsights = useMemo(() => {
    if (!lineName || !description || !allWOs) return null;
    const cutoff30 = subDays(new Date(), 30).toISOString();
    const similar = allWOs.filter((w) => (w as any).line_at_time === lineName && w.description === description && w.created_at >= cutoff30);
    if (!similar.length) return null;
    const cutoff7 = subDays(new Date(), 7).toISOString();
    const weekCount = similar.filter((w) => w.created_at >= cutoff7).length;
    return { occurrences: similar.length, weekCount, isRecurring: weekCount >= 3 };
  }, [lineName, description, allWOs]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requestedBy.trim()) {
      toast({ title: "Name required", description: "Please enter your name before sending the request.", variant: "destructive" });
      return;
    }
    const finalDescription = description === "__custom__" ? customDescription.trim() : description.trim();
    if (!finalDescription) {
      toast({ title: "Problem required", description: "Please describe the problem.", variant: "destructive" });
      return;
    }
    if (isSealerPrinterLine && !physicalLineId) {
      toast({ title: "Production Line required", description: "Select the line where the sealer/printer is being used.", variant: "destructive" });
      return;
    }
    if (!isSealerPrinterLine && !machineName) {
      toast({ title: "Machine required", description: "Please select the machine that needs maintenance.", variant: "destructive" });
      return;
    }
    try {
      let created_at: string | undefined;
      if (isRetroactive && retroDate) {
        const d = new Date(retroDate);
        if (retroTime) {
          const [h, m] = retroTime.split(":").map(Number);
          d.setHours(h, m, 0, 0);
        }
        created_at = d.toISOString();
      }
      const effectivePriority = lineStopped ? "high" : autoPriority.priority;
      // For Sealer/Printer line, combine sealer + printer labels for tracking.
      let machineLabel = "";
      if (mobileAssetId || secondaryAssetId) {
        const sealer = mobileAssets?.find((a) => a.id === mobileAssetId);
        const printer = mobileAssets?.find((a) => a.id === secondaryAssetId);
        const assetParts = [sealer && formatMobileAsset(sealer), printer && formatMobileAsset(printer)]
          .filter(Boolean).join(" + ");
        const physLineName = lines?.find((l: any) => l.id === physicalLineId)?.name;
        machineLabel = physLineName ? `${assetParts} @ ${physLineName}` : assetParts;
      } else if (machineName) {
        // Regular line: use the machine the operator picked.
        machineLabel = machineName;
      }
      await createWO.mutateAsync({
        requester_name: requestedBy.trim(),
        // For Sealer/Printer WOs, store the REAL production line as line_id so
        // it shows correctly in the "Line" column everywhere. The sealer/printer
        // asset stays tracked via mobile_asset_id + machine label.
        line_id: isSealerPrinterLine ? physicalLineId : lineId,
        mobile_asset_id: mobileAssetId || secondaryAssetId || null,
        physical_line_id: isSealerPrinterLine ? physicalLineId : null,
        machine: machineLabel,
        description: finalDescription,
        notes: notes.trim(),
        priority: effectivePriority,
        created_at,
        line_stopped: lineStopped,
      });
      toast({ title: lineStopped ? "🛑 WO Sent — Line Stopped" : "✓ WO Sent — Line Running", description: "Engineers have been notified." });
      setRequestedBy(""); setMachineName(""); setMobileAssetId(""); setSecondaryAssetId(""); setPhysicalLineId(""); setDescription(""); setCustomDescription(""); setNotes("");
      setIsRetroactive(false); setRetroDate(undefined); setRetroTime(""); setLineStopped(false);
    } catch {
      toast({ title: "Error", description: "Failed to create work order", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6 max-w-6xl xl:max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold">Operator Panel</h2>
          <p className="text-muted-foreground">Open a maintenance request</p>
        </div>
      </div>

      {/* Compact state toggle — Line Stopped vs Line Running */}
      <div className="inline-flex rounded-md border bg-card p-1 text-sm">
        <button
          type="button"
          onClick={() => { setLineStopped(true); document.getElementById("wo-form-anchor")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
          className={cn(
            "px-3 h-8 rounded-sm font-medium transition-colors inline-flex items-center gap-1.5",
            lineStopped ? "bg-red-600 text-white" : "text-muted-foreground hover:bg-accent"
          )}
        >
          <StopCircle className="h-4 w-4" /> Stopped
        </button>
        <button
          type="button"
          onClick={() => { setLineStopped(false); document.getElementById("wo-form-anchor")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
          className={cn(
            "px-3 h-8 rounded-sm font-medium transition-colors inline-flex items-center gap-1.5",
            !lineStopped ? "bg-amber-500 text-white" : "text-muted-foreground hover:bg-accent"
          )}
        >
          <AlertCircle className="h-4 w-4" /> Running
        </button>
      </div>





      <div id="wo-form-anchor" />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 flex-wrap">
            <Plus className="h-5 w-5" />
            Create Work Order
            {lineName && (
              <Badge variant="outline" className="ml-1 border-primary text-primary font-semibold">
                Line: {lineName}
              </Badge>
            )}
            {lineStopped && <Badge variant="destructive" className="ml-2 gap-1"><StopCircle className="h-3 w-3" /> Line Stopped</Badge>}
            {!lineStopped && (requestedBy || description) && <Badge className="ml-2 gap-1 bg-amber-500 text-white border-amber-500"><AlertCircle className="h-3 w-3" /> Line Running</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2" autoComplete="off">
            <div className="space-y-2">
              <Label htmlFor="requested-by">Requested By <span className="text-destructive">*</span></Label>
              <Input
                id="requested-by"
                name="requested-by"
                type="text"
                value={requestedBy}
                onChange={(e) => setRequestedBy(e.target.value)}
                placeholder="Type the requester's name..."
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                aria-invalid={!requestedBy.trim()}
                className={cn(!requestedBy.trim() && "border-destructive/60")}
              />
              {!requestedBy.trim() && <p className="text-xs text-destructive">Enter your name to send the request.</p>}
            </div>

            {/* WO target — Line vs Sealer/Printer Ink (available on every operator login) */}
            <div className="md:col-span-2 space-y-2">
              <Label>What needs maintenance?</Label>
              <div className="inline-flex rounded-md border bg-card p-1 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => {
                    setTargetMode("line");
                    setMobileAssetId(""); setSecondaryAssetId(""); setPhysicalLineId("");
                  }}
                  className={cn(
                    "flex-1 sm:flex-none px-4 h-11 rounded-sm font-semibold transition-colors inline-flex items-center justify-center gap-1.5",
                    targetMode === "line" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
                  )}
                >
                  <Factory className="h-4 w-4" /> {lineName || "Line"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTargetMode("sealer_printer");
                    setMachineName("");
                    // Auto-bind the operator's own line; the picker only shows
                    // when the login itself is a Sealer/Printer placeholder line.
                    if (lineId && !lineIsSealerPrinter) setPhysicalLineId(lineId);
                  }}
                  className={cn(
                    "flex-1 sm:flex-none px-4 h-11 rounded-sm font-semibold transition-colors inline-flex items-center justify-center gap-1.5",
                    targetMode === "sealer_printer" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
                  )}
                >
                  <Printer className="h-4 w-4" /> Sealer / Printer Ink
                </button>
              </div>
            </div>

            {/* Mobile-asset sub-picker — shown whenever Sealer/Printer mode is active. */}
            {isSealerPrinterLine && (
              <>
                <div className="md:col-span-2">
                  <MobileAssetSubPicker
                    lineId={lineId}
                    sealerId={mobileAssetId}
                    printerId={secondaryAssetId}
                    onChange={({ sealerId, printerId }) => {
                      setMobileAssetId(sealerId);
                      setSecondaryAssetId(printerId);
                    }}
                  />
                </div>
                {lineIsSealerPrinter ? (
                  <div className="md:col-span-2 space-y-2">
                    <Label htmlFor="physical-line">Production Line (where the sealer/printer is being used) *</Label>
                    <Select value={physicalLineId} onValueChange={setPhysicalLineId}>
                      <SelectTrigger id="physical-line" className="h-12">
                        <SelectValue placeholder="Select the production line..." />
                      </SelectTrigger>
                      <SelectContent>
                        {(lines || [])
                          .filter((l: any) => !/sealer|printer/i.test(l.name))
                          .map((l: any) => (
                            <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
              </>
            )}

            {/* Machine picker — regular lines only (sealer/printer line uses its own asset sub-picker). */}
            {!isSealerPrinterLine && (
              <div className="md:col-span-2 space-y-2">
                <Label htmlFor="machine">
                  Machine <span className="text-destructive">*</span>
                </Label>
                {(() => {
                  const showList = (machines || []).filter((m: any) => {
                    if (m.category === "line_mobile") return false;
                    if (!lineName && !lineId) return false;
                    if (lineId && m.line_id && m.line_id === lineId) return true;
                    if (lineName && m.name === lineName) return true;
                    const base = (m.current_line || m.fixed_line || m.line || "").toString();
                    if (!base) return false;
                    const withSide = (m.side === "A" || m.side === "B") ? `${base}${m.side}` : base;
                    return withSide === lineName || base === lineName;
                  });
                  return (
                    <Select value={machineName} onValueChange={(v) => setMachineName(v)}>
                      <SelectTrigger id="machine" className={cn("h-12", !machineName && "border-destructive/60")}>
                        <SelectValue placeholder="Select the machine on this line..." />
                      </SelectTrigger>
                      <SelectContent className="max-h-[60vh]">
                        {showList.map((m: any) => {
                          const isUuid = typeof m.code === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(m.code);
                          const showCode = m.code && !isUuid;
                          return (
                            <SelectItem key={m.id} value={m.name}>
                              {m.name}{showCode ? ` (${m.code})` : ""}
                            </SelectItem>
                          );
                        })}
                        {showList.length === 0 && (
                          <div className="p-3 text-xs text-muted-foreground">
                            No machines registered for your line ({lineName || "unassigned"}). Please contact your supervisor.
                          </div>
                        )}
                      </SelectContent>
                    </Select>
                  );
                })()}


                {!machineName ? (
                  <p className="text-xs text-destructive">Please select the machine that needs maintenance.</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Pick the specific machine so the WO history is accurate.
                  </p>
                )}
                {(() => {
                  const m: any = (machines || []).find((x: any) => x.name === machineName);
                  if (!m || m.category !== "line_mobile") return null;
                  const at = (m.current_line || "").toString();
                  if (at === lineName) {
                    return <p className="text-xs text-emerald-600 inline-flex items-center gap-1"><CheckCircle className="h-3 w-3" /> {m.name} is currently on {lineName}.</p>;
                  }
                  return (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-amber-600">
                        {m.name} is {at ? `at ${at}` : "not assigned"} — move it to {lineName}?
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="h-7"
                        onClick={async () => {
                          const { error } = await (supabase as any).rpc("move_machine_to_line", {
                            _machine_id: m.id,
                            _new_line: lineName,
                            _notes: "Moved by operator from WO dialog",
                          });
                          if (error) { sonnerToast.error(error.message); return; }
                          sonnerToast.success(`${m.name} moved to ${lineName}`);
                          qcRef.invalidateQueries({ queryKey: ["machines"] });
                        }}
                      >
                        Move here
                      </Button>
                    </div>
                  );
                })()}
              </div>
            )}


            <div className="space-y-2">
              <Label htmlFor="desc">Problem Description</Label>
              <Select value={description} onValueChange={(v) => { setDescription(v); if (v !== "__custom__") setCustomDescription(""); }}>
                <SelectTrigger><SelectValue placeholder="Select problem..." /></SelectTrigger>
                <SelectContent>
                  {(() => {
                    if (!isSealerPrinterLine) {
                      return [
                        ...(problemDescriptions || []).map((pd: any) => (
                          <SelectItem key={pd.id} value={pd.name}>{pd.name}</SelectItem>
                        )),
                        <SelectItem key="__custom__" value="__custom__">Other — describe the problem…</SelectItem>,
                      ];
                    }
                    // Curated, guaranteed list for Sealer / Printer Ink mode.
                    const guaranteed = [
                      "Printer Fault",
                      "Ink Issue",
                      "Print Quality",
                      "Bag Sealer Fault",
                      "Conveyor Fault",
                      "Sensor Issue",
                    ];
                    const seen = new Set(guaranteed.map((n) => n.toLowerCase()));
                    const extras = (problemDescriptions || []).filter((pd: any) => {
                      const n = String(pd.name || "").toLowerCase();
                      return /printer|ink|label|sealer|bag|conveyor/i.test(n) && !seen.has(n);
                    });
                    return [
                      ...guaranteed.map((name) => (
                        <SelectItem key={`guaranteed-${name}`} value={name}>{name}</SelectItem>
                      )),
                      ...extras.map((pd: any) => (
                        <SelectItem key={pd.id} value={pd.name}>{pd.name}</SelectItem>
                      )),
                      <SelectItem key="__custom__" value="__custom__">Other — describe the problem…</SelectItem>,
                    ];
                  })()}
                </SelectContent>
              </Select>
              {description === "__custom__" && (
                <div className="space-y-1 md:col-span-2">
                  <Label htmlFor="custom-desc" className="text-xs">Describe the problem</Label>
                  <Textarea
                    id="custom-desc"
                    placeholder="Describe the problem..."
                    autoFocus
                    value={customDescription}
                    onChange={(e) => setCustomDescription(e.target.value)}
                    rows={2}
                    autoComplete="off"
                  />
                </div>
              )}
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="notes">Observations (optional)</Label>
              <Textarea id="notes" placeholder="Additional notes or context..." value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
            </div>
            {/* Retroactive Order Toggle */}
            <div className="md:col-span-2 flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <Switch id="retroactive" checked={isRetroactive} onCheckedChange={setIsRetroactive} />
                <Label htmlFor="retroactive">Retroactive Order (past date/time)</Label>
              </div>
              {isRetroactive && (
                <div className="flex flex-wrap gap-4 items-end">
                  <div className="space-y-1">
                    <Label>Date</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button type="button" variant="outline" className={cn("w-[200px] justify-start text-left font-normal", !retroDate && "text-muted-foreground")}>
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {retroDate ? format(retroDate, "dd/MM/yyyy") : "Pick a date"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={retroDate}
                          onSelect={setRetroDate}
                          disabled={(date) => date > new Date()}
                          initialFocus
                          className={cn("p-3 pointer-events-auto")}
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="space-y-1">
                    <Label>Time</Label>
                    <Input type="time" value={retroTime} onChange={(e) => setRetroTime(e.target.value)} className="w-[140px]" />
                  </div>
                </div>
              )}
            </div>
            {/* Smart Suggestions */}
            {machineSuggestions && (
              <div className="md:col-span-2">
                <Card className="border-amber-500/30 bg-amber-500/5">
                  <CardContent className="p-3 flex flex-wrap gap-4 items-center text-sm">
                    <div className="flex items-center gap-1.5">
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                      <span className="font-medium">{machineSuggestions.totalWOs} previous WO(s)</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <span>Last WO: {machineSuggestions.daysSinceLast} day(s) ago</span>
                    </div>
                    {machineSuggestions.topProblems.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-muted-foreground">Common:</span>
                        {machineSuggestions.topProblems.map(([problem, count]) => (
                          <Badge key={problem} variant="secondary" className="text-xs">{problem} ({count}x)</Badge>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}
            {/* AI Insights + Auto Priority */}
            {aiInsights && (
              <div className="md:col-span-2">
                <Card className={cn("border-l-4", autoPriority.priority === "high" ? "border-l-red-500 bg-red-500/5" : autoPriority.priority === "medium" ? "border-l-amber-500 bg-amber-500/5" : "border-l-green-500 bg-green-500/5")}>
                  <CardContent className="p-3 space-y-1">
                    <div className="flex items-center gap-2 text-sm">
                      <Zap className="h-4 w-4" />
                      <span className="font-medium">AI Insight</span>
                      <Badge variant="outline" className={cn("text-xs", priorityChipClass[autoPriority.priority] ?? priorityChipClass.low)}>
                        Priority: {autoPriority.priority.toUpperCase()}
                      </Badge>
                      {aiInsights.isRecurring && <Badge variant="destructive" className="text-xs">Recurring</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">{autoPriority.reason}</p>
                    <p className="text-xs text-muted-foreground">{aiInsights.occurrences} occurrence(s) in 30 days{aiInsights.weekCount > 0 ? `, ${aiInsights.weekCount} this week` : ""}</p>
                  </CardContent>
                </Card>
              </div>
            )}
            <div className="md:col-span-2">
              <Button
                type="submit"
                disabled={createWO.isPending}
                className="touch-manipulation"
                title={typeof navigator !== "undefined" && !navigator.onLine ? "Offline — will sync when connection is restored" : undefined}
              >
                {createWO.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Submit Work Order
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* WOs by Shift chart moved to top of dashboard */}


      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5" />
              My Work Orders
            </CardTitle>
            <Button size="sm" variant="outline" onClick={() => navigate("/dashboard/operator/my-production")}>
              <Factory className="h-4 w-4 mr-2" />
              My Production
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-muted-foreground">
            Showing <b>this shift only</b> ({SHIFT_LABEL[getCurrentFactoryShift().shiftCode]}). Orders from previous shifts drop off automatically.
          </p>
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : !shiftWOs.length ? (
            <p className="text-muted-foreground text-center py-8">No work orders this shift yet. Create one above!</p>
          ) : (
            <div className="overflow-x-auto -mx-3 sm:mx-0">
            <Table>
              <TableHeader>
                <TableRow>
                   <TableHead>WO#</TableHead>
                   <TableHead>Line</TableHead>
                   <TableHead>Machine</TableHead>
                   <TableHead>Problem</TableHead>
                   <TableHead>Status</TableHead>
                   <TableHead>Created</TableHead>
                   <TableHead>Shift</TableHead>
                   <TableHead>Created By</TableHead>
                   <TableHead>Engineer</TableHead>
                    <TableHead>Parts</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
               </TableHeader>
               <TableBody>
                 {shiftWOs
                   .map((wo) => {
                   const cfg = statusConfig[wo.status] || statusConfig.open;
                   const shift = getShift(wo.created_at);
                   return (
                     <TableRow key={wo.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/dashboard/wo/${wo.id}`)}>
                       <TableCell className="font-mono font-medium whitespace-nowrap">
                         <div className="flex items-center gap-2">
                           <span className="text-xs sm:text-sm">WO-{new Date(wo.created_at).getFullYear()}-{String(wo.wo_number).padStart(6, "0")}</span>
                           <RecurrenceBadge originalWoId={(wo as any).recurrence_of_wo_id} compact />
                         </div>
                       </TableCell>
                       <TableCell className="font-medium">{lines?.find((l) => l.id === (wo as any).line_id)?.name || machines?.find((m) => m.name === wo.machine)?.line || "—"}</TableCell>
                       <TableCell>{wo.machine || "—"}</TableCell>
                       <TableCell className="text-sm text-muted-foreground truncate max-w-[200px]">{wo.description}</TableCell>
                       <TableCell><Badge variant="outline" className={cfg.className}>{cfg.label}</Badge></TableCell>
                       <TableCell className="text-sm text-muted-foreground">{format(new Date(wo.created_at), "dd/MM HH:mm")}</TableCell>
                       <TableCell className="text-xs">
                         <Badge variant="outline" className={shift === "day" ? "bg-blue-50 text-blue-700" : "bg-indigo-900/30 text-indigo-200"}>
                           {shift === "day" ? "Day" : "Night"}
                         </Badge>
                       </TableCell>
                       <TableCell className="text-sm">{wo.requester_name || "—"}</TableCell>
                       <TableCell className="text-sm">{wo.engineer?.name || "—"}</TableCell>
                       <TableCell>
                          {partsCounts?.[wo.id] ? (
                            <Badge variant="secondary">{partsCounts[wo.id]}</Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                         </TableCell>
                         <TableCell onClick={(e) => e.stopPropagation()}>
                           {wo.status === "finished" && (
                              <Button
                                size="sm"
                                variant="default"
                                className="h-11 min-w-11 px-3 touch-manipulation"
                                disabled={closeWO.isPending}
                                onClick={() => handleQuickClose(wo.id, wo.requester_name ?? null)}
                                aria-label="Close work order"
                              >
                                <CheckCircle className="h-4 w-4 mr-1.5" aria-hidden="true" /> Close
                              </Button>
                           )}
                         </TableCell>
                       </TableRow>
                   );
                 })}
               </TableBody>
             </Table>
             </div>
           )}
         </CardContent>
       </Card>

    </div>
  );
}
