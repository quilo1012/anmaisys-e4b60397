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
import { ClipboardList, Plus, Loader2, AlertTriangle, Clock, CalendarIcon, CheckCircle, Zap } from "lucide-react";
import { useWorkOrders, useCreateWorkOrder, useCloseWorkOrder } from "@/hooks/useWorkOrders";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { usePartsCountByWOs } from "@/hooks/useStock";
import { useMachines, useLines } from "@/hooks/useMachines";
import { useMobileAssets, formatMobileAsset } from "@/hooks/useMobileAssets";
import { MobileAssetSubPicker } from "@/components/MobileAssetSubPicker";
import { useActiveProblemsForLine } from "@/hooks/useLineProblemDescriptions";
import { useProfileNames } from "@/hooks/useProfileNames";
import { OperatorLineGuard } from "@/components/OperatorLineGuard";
import { useDeviceLineCtx } from "@/contexts/DeviceLineContext";
import { useToast } from "@/hooks/use-toast";
import { useNavigate, Navigate } from "react-router-dom";
import { format, differenceInDays, subDays } from "date-fns";
import { cn } from "@/lib/utils";
import { RecurrenceBadge } from "@/components/RecurrenceBadge";
import { OperatorNavCards } from "@/components/DashboardNavCards";
import { ComboboxInput } from "@/components/ComboboxInput";

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
  if (role !== "operator") {
    return null;
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
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [requestedBy, setRequestedBy] = useState("");
  const [lineStopped, setLineStopped] = useState(false);
  const [isRetroactive, setIsRetroactive] = useState(false);
  const [retroDate, setRetroDate] = useState<Date>();
  const [retroTime, setRetroTime] = useState("");

  // Tablet is paired (guard guarantees lineId) — always scope to this line.
  const { data: workOrders, isLoading } = useWorkOrders({ lineId });
  const { data: allWOs } = useWorkOrders({ lineId });
  const woIds = workOrders?.map((wo) => wo.id) || [];
  const { data: partsCounts } = usePartsCountByWOs(woIds);
  const { data: machines } = useMachines();
  const { data: lines } = useLines();
  const { data: mobileAssets } = useMobileAssets();
  const { data: problemDescriptions } = useActiveProblemsForLine(lineId);
  const { data: profileNames } = useProfileNames();
  const createWO = useCreateWorkOrder();
  const closeWO = useCloseWorkOrder();
  const { toast } = useToast();
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

  // Detect Sealer/Printer line by name to show the asset sub-picker.
  const isSealerPrinterLine = useMemo(
    () => /sealer|printer/i.test(lineName),
    [lineName]
  );

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
    if (!description.trim()) {
      toast({ title: "Problem required", description: "Please describe the problem.", variant: "destructive" });
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
        machineLabel = [sealer && formatMobileAsset(sealer), printer && formatMobileAsset(printer)]
          .filter(Boolean).join(" + ");
      }
      await createWO.mutateAsync({
        requester_name: requestedBy.trim(),
        line_id: lineId, // hard-locked from device context
        mobile_asset_id: mobileAssetId || secondaryAssetId || null,
        machine: machineLabel,
        description: description.trim(),
        notes: notes.trim(),
        priority: effectivePriority,
        created_at,
        line_stopped: lineStopped,
      });
      toast({ title: lineStopped ? "🛑 WO Sent — Line Stopped" : "✓ WO Sent — Line Running", description: "Engineers have been notified." });
      setRequestedBy(""); setMobileAssetId(""); setSecondaryAssetId(""); setDescription(""); setNotes("");
      setIsRetroactive(false); setRetroDate(undefined); setRetroTime(""); setLineStopped(false);
    } catch {
      toast({ title: "Error", description: "Failed to create work order", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Operator Panel</h2>
        <p className="text-muted-foreground">Create and track your work orders</p>
      </div>

      <OperatorNavCards myOpenWOs={workOrders?.filter((w) => w.status === "open" || w.status === "in_progress").length ?? 0} />

      {/* Quick CTA buttons — Line Stopped vs Line Running */}
      <div className="grid gap-4 md:grid-cols-2">
        <button
          type="button"
          onClick={() => { setLineStopped(true); document.getElementById("wo-form-anchor")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
          className="rounded-xl border-2 border-red-600 bg-red-600 text-white p-6 text-left shadow-lg hover:bg-red-700 hover:scale-[1.01] transition-all"
        >
          <div className="text-4xl mb-2">🛑</div>
          <div className="text-2xl font-bold mb-1">MACHINE STOPPED</div>
          <div className="text-sm opacity-90">Open WO Request — Line Stopped (downtime starts now)</div>
        </button>
        <button
          type="button"
          onClick={() => { setLineStopped(false); document.getElementById("wo-form-anchor")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
          className="rounded-xl border-2 border-amber-500 bg-amber-500 text-white p-6 text-left shadow-lg hover:bg-amber-600 hover:scale-[1.01] transition-all"
        >
          <div className="text-4xl mb-2">⚠️</div>
          <div className="text-2xl font-bold mb-1">PROBLEM, LINE STILL RUNNING</div>
          <div className="text-sm opacity-90">Open WO Request — Line in Operation (no downtime)</div>
        </button>
      </div>

      <div id="wo-form-anchor" />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            Create Work Order
            {lineStopped && <Badge variant="destructive" className="ml-2">🛑 Line Stopped</Badge>}
            {!lineStopped && (requestedBy || description) && <Badge className="ml-2 bg-amber-500 text-white border-amber-500">⚠️ Line Running</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2" autoComplete="off">
            <div className="space-y-2">
              <Label htmlFor="requested-by">Requested By</Label>
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
              />
            </div>

            {/* Mobile-asset sub-picker (only on Sealer/Printer line). Line itself is locked. */}
            {isSealerPrinterLine && (
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
            )}

            <div className="space-y-2">
              <Label htmlFor="desc">Problem Description</Label>
              <Select value={description} onValueChange={setDescription}>
                <SelectTrigger><SelectValue placeholder="Select problem..." /></SelectTrigger>
                <SelectContent>
                  {problemDescriptions?.map((pd) => (
                    <SelectItem key={pd.id} value={pd.name}>{pd.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                        <Button variant="outline" className={cn("w-[200px] justify-start text-left font-normal", !retroDate && "text-muted-foreground")}>
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
                      <Badge variant="outline" className={cn("text-xs", autoPriority.priority === "high" ? "bg-red-100 text-red-800" : autoPriority.priority === "medium" ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-800")}>
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
                   <TableHead>Engineer</TableHead>
                    <TableHead>Parts</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
               </TableHeader>
               <TableBody>
                 {workOrders.map((wo) => {
                   const cfg = statusConfig[wo.status] || statusConfig.open;
                   return (
                     <TableRow key={wo.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/dashboard/wo/${wo.id}`)}>
                       <TableCell className="font-mono font-medium">
                         <div className="flex items-center gap-2">
                           <span>WO-{new Date(wo.created_at).getFullYear()}-{String(wo.wo_number).padStart(6, "0")}</span>
                           <RecurrenceBadge originalWoId={(wo as any).recurrence_of_wo_id} compact />
                         </div>
                       </TableCell>
                       <TableCell className="font-medium">{machines?.find((m) => m.name === wo.machine)?.line || "—"}</TableCell>
                       <TableCell>{wo.machine}</TableCell>
                       <TableCell className="text-sm text-muted-foreground truncate max-w-[200px]">{wo.description}</TableCell>
                       <TableCell><Badge variant="outline" className={cfg.className}>{cfg.label}</Badge></TableCell>
                       <TableCell className="text-sm text-muted-foreground">{format(new Date(wo.created_at), "dd/MM HH:mm")}</TableCell>
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
                              disabled={closeWO.isPending}
                              onClick={() => handleQuickClose(wo.id, wo.requester_name ?? null)}
                            >
                              <CheckCircle className="h-3 w-3 mr-1" /> Close
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
