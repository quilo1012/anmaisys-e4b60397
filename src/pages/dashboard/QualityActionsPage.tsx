import { useMemo, useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { DateRangeFilter, getPresetRange, type DateRange, type DateRangePreset } from "@/components/DateRangeFilter";
import { generateQualityReportPDF, generateQualityReportExcel } from "@/lib/qualityReport";
import { useAuth } from "@/contexts/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Download, List, BarChart3, Tags, Trash2, Upload, Camera, Clock, X, Loader2, ClipboardCheck, Printer, Pencil } from "lucide-react";
import { QualityImportDialog } from "@/components/QualityImportDialog";
import { SectionErrorBoundary } from "@/components/SectionErrorBoundary";
import { toast } from "sonner";
import { format } from "date-fns";
import { resolveReportRange, reportPeriodLabel } from "@/lib/reportRange";
import { getCurrentFactoryShift, shiftDateFetchRange, shiftSessionDate } from "@/lib/shifts";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { cn } from "@/lib/utils";
import { QUALITY_LABELS, QUALITY_DEPARTMENTS, QUALITY_SEVERITIES, statusMeta, severityMeta, severityPoints, sumSeverityPoints, VALIDATION_STATES, validationMeta, isClosed } from "@/lib/qualityConstants";
import { useQualityOptions, useAllQualityOptions, type QualityOption } from "@/hooks/useQualityOptions";
import { useSeverityPointRows, useUpdateSeverityPoints } from "@/hooks/useSeverityPoints";
import { useLeaderScoreWeights, useUpdateLeaderScoreWeights } from "@/hooks/useLeaderScoreWeights";
import { DEFAULT_WEIGHTS, type LeaderScoreWeights } from "@/lib/leaderScore";
import { useRole } from "@/hooks/useRole";
import { useQualityHistory, getQualityPhotoUrl, useUploadQualityPhoto, useDeleteQualityPhoto, type QualityHistoryRow } from "@/hooks/useQualityIssue";
import { KpiCard } from "@/components/reports/KpiCard";
import { QualityTrackingByLeader } from "@/components/quality/QualityTrackingByLeader";
import { OPS_RANGE_KEY } from "@/hooks/useOpsFilters";

interface ActionType { id: string; code: string; label: string; points: number; active: boolean }
interface QualityAction {
  id: string; action_no: string | null; action_type_id: string; line: string | null; shift: string | null;
  leader_name: string | null; department: string | null; status: string; labels: string[] | null;
  description: string | null; recorded_at: string; points: number | null;
  severity: string | null; attachments: string[] | null;
  validation_status: string | null; validated_at: string | null; validated_by: string | null;
  closed_at: string | null; closed_by: string | null;
  sku: string | null; batch: string | null;
}

// Resolve a SKU code from a production_items row without relying on a PostgREST
// embed (which can 400 on relationship/permission edge cases).
async function resolveSkuCode(it: { sku_code_text?: string | null; sku_id?: string | null }): Promise<string> {
  if (it?.sku_code_text) return it.sku_code_text;
  if (it?.sku_id) {
    const { data } = await (supabase as any).from("sku_products").select("code").eq("id", it.sku_id).maybeSingle();
    return data?.code ?? "";
  }
  return "";
}

const todayISO = () => new Date().toISOString().slice(0, 10);
const makeEmptyForm = () => ({
  action_no: "", action_type_id: "", line: "", shift: "DAY", leader_id: "", leader_name: "",
  date: todayISO(), sku: "", batch: "",
  department: "", status: "todo", severity: "", labels: [] as string[], description: "",
});

/** Trash button + confirm, for deleting a quality action straight from the list
 *  instead of digging into the detail dialog. Shown only when the viewer can
 *  manage quality. */
function RowDeleteButton({ actionNo, onConfirm }: { actionNo?: string | number | null; onConfirm: () => void }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive-strong hover:text-destructive-strong" title="Delete action" aria-label="Delete action">
          <Trash2 className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this action?</AlertDialogTitle>
          <AlertDialogDescription>
            {actionNo ? `Action ${actionNo}` : "This action"} will be permanently removed. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={onConfirm}>Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function QualityActionsView() {
  const { can } = useRole();
  const canManage = can("quality.manage");
  // Two capabilities, not one, because the database holds two: Quality rules on the
  // deviation, a manager approves filing it. Showing a supervisor a control the
  // trigger will refuse is worse than not showing it.
  const canValidate = can("quality.validate");
  const canClose = can("quality.close");
  const qc = useQueryClient();

  const { data: qOpts } = useQualityOptions();
  const LABELS = qOpts?.labels ?? [...QUALITY_LABELS];
  const DEPTS = qOpts?.departments ?? [...QUALITY_DEPARTMENTS];

  // Kanban is gone. A To do / In progress / Complete board is the working view of
  // whoever moves the cards; this screen is read by supervisors and managers, and the
  // board took the height that the numbers they come for now use. The statuses are
  // still on every row, still filterable, still editable inline in the Log.
  const [view, setView] = useState<"list" | "analytics">("list");
  const { profile } = useAuth();
  const isMobile = useIsMobile();
  const [listsOpen, setListsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [drRange, setDrRange] = useState<DateRange>(() => getPresetRange("30d"));
  const [drPreset, setDrPreset] = useState<DateRangePreset>("30d");
  const [filterLine, setFilterLine] = useState("__all__");
  const [filterLeader, setFilterLeader] = useState("__all__");
  const [filterDept, setFilterDept] = useState("__all__");
  const [filterSeverity, setFilterSeverity] = useState("__all__");
  // "__pending__" is not a stored value — it is the question people actually ask of
  // this board: what is still waiting on Quality? Open and Under investigation both
  // answer it, and neither is findable by picking a single status.
  const [filterValidation, setFilterValidation] = useState("__all__");
  const [filterShift, setFilterShift] = useState("__all__");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(makeEmptyForm());
  const [editingId, setEditingId] = useState<string | null>(null);

  // Open the same form pre-filled to edit an existing action.
  const openEdit = (a: QualityAction) => {
    setEditingId(a.id);
    setForm({
      action_no: a.action_no ?? "",
      action_type_id: "",
      line: a.line ?? "",
      shift: a.shift ?? "DAY",
      leader_id: leaders.find((l) => l.name === a.leader_name)?.id ?? "",
      leader_name: a.leader_name ?? "",
      date: a.recorded_at ? a.recorded_at.slice(0, 10) : todayISO(),
      sku: a.sku ?? "",
      batch: a.batch ?? "",
      department: a.department ?? "",
      status: a.status ?? "todo",
      severity: a.severity ?? "",
      labels: a.labels ?? [],
      description: a.description ?? "",
    });
    setDetailId(null);
    setOpen(true);
  };

  /**
   * "All time" quer dizer desde sempre, e não o último mês.
   *
   * `getPresetRange("all")` devolve `{}` de propósito — intervalo aberto, filtro
   * nenhum. Quem escrevia `drRange.from ?? subDays(new Date(), 30)` reintroduzia
   * aqui os trinta dias que a preset tinha acabado de recusar: o chip dizia "All
   * time" e os números por baixo eram o último mês. O `periodLabel` levava a
   * mesma data para o cabeçalho impresso, por isso a folha saía assinada com um
   * período que não era o dos números — que num sistema com ambição BRCGS é um
   * problema de auditoria e não de interface.
   *
   * Hoje as `quality_actions` mais antigas são de 25/07 e cabem todas nos trinta
   * dias, por isso isto ainda não mente. Passa a mentir quando as primeiras
   * envelhecerem, que é dentro de dias.
   *
   * `resolveReportRange` é a mesma função que a Analytics e a PM Intelligence já
   * usam, com a sentinela de 2000 no fundo — ver `reportRange.ts`.
   */
  const period = useMemo(() => resolveReportRange(drRange), [drRange]);
  const from = useMemo(() => format(period.startDate, "yyyy-MM-dd"), [period]);
  const to = useMemo(() => format(period.endDate, "yyyy-MM-dd"), [period]);
  const periodLabel = useMemo(() => `Period: ${reportPeriodLabel(period, "dd/MM/yyyy")}`, [period]);

  const { data: types = [] } = useQuery({
    queryKey: ["quality_action_types"],
    queryFn: async () => {
      const { data, error } = await supabase.from("quality_action_types").select("*").order("label");
      if (error) throw error;
      return (data ?? []) as ActionType[];
    },
  });
  const { data: lines = [] } = useQuery({
    queryKey: ["lines"],
    queryFn: async () => {
      const { data, error } = await supabase.from("lines").select("name").order("name");
      if (error) throw error;
      // Drop blank names — a Radix <SelectItem value=""> would crash the Line select.
      return (data ?? []).filter((x) => x.name && x.name.trim()) as { name: string }[];
    },
  });
  // "Office" isn't a production line, but quality actions get raised there too.
  const lineOptions = useMemo(
    () => (lines.some((l) => l.name.toLowerCase() === "office") ? lines : [...lines, { name: "Office" }]),
    [lines],
  );
  const { data: leaders = [] } = useQuery({
    queryKey: ["line_leaders_active"],
    queryFn: async () => {
      const { data, error } = await supabase.from("line_leaders").select("id, name").eq("active", true).order("name");
      if (error) throw error;
      return (data ?? []).filter((x) => x.id && x.name && x.name.trim()) as { id: string; name: string }[];
    },
  });
  const { data: actions = [] } = useQuery({
    queryKey: ["quality_actions", from, to],
    queryFn: async () => {
      const window = shiftDateFetchRange(from, to);
      const { data, error } = await supabase.from("quality_actions").select("*").gte("recorded_at", window.gte).lte("recorded_at", window.lte).order("recorded_at", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as unknown as QualityAction[]).filter((a) => {
        const day = shiftSessionDate(a.recorded_at, a.shift);
        return day >= from && day <= to;
      });
    },
  });

  const filtered = useMemo(() =>
    actions.filter((a) =>
      (filterLine === "__all__" || a.line === filterLine) &&
      (filterLeader === "__all__" || a.leader_name === filterLeader) &&
      (filterDept === "__all__" || a.department === filterDept) &&
      (filterSeverity === "__all__" || (a.severity ?? "") === filterSeverity) &&
      (filterShift === "__all__" || a.shift === filterShift) &&
      (filterValidation === "__all__" ||
        (filterValidation === "__pending__"
          ? !["validated", "rejected"].includes(a.validation_status ?? "open")
          : (a.validation_status ?? "open") === filterValidation))),
    [actions, filterLine, filterLeader, filterDept, filterSeverity, filterShift, filterValidation]
  );

  const detailAction = useMemo(() => actions.find((a) => a.id === detailId) ?? null, [actions, detailId]);


  const kpis = useMemo(() => {
    // "Open" now means Quality has not filed it. The To do / In progress / Complete
    // board is gone; what remains is the lifecycle that carries a signature —
    // raised → validated or rejected → closed by a manager.
    const open = filtered.filter((x) => !isClosed(x));
    return {
      total: filtered.length,
      // Weighted, not counted: ten Low actions and one Critical are not the same
      // problem, and the counts alone said they were.
      openPoints: sumSeverityPoints(open),
      totalPoints: sumSeverityPoints(filtered),
      openSevere: open.filter((x) => x.severity === "high" || x.severity === "critical").length,
      ungraded: filtered.filter((x) => !x.severity).length,
      // Counted over `actions`, not `filtered`: the moment the filter is set to
      // "Waiting on Quality" a count taken from the filtered rows would equal the
      // total and stop being an answer to anything.
      awaitingVerdict: actions.filter((x) => !["validated", "rejected"].includes(x.validation_status ?? "open")).length,
    };
  }, [filtered, actions]);

  const toggleLabel = (l: string) =>
    setForm((f) => ({ ...f, labels: f.labels.includes(l) ? f.labels.filter((x) => x !== l) : [...f.labels, l] }));

  const create = useMutation({
    mutationFn: async () => {
      const leader = leaders.find((l) => l.id === form.leader_id);
      const recorded_at = new Date(`${form.date || todayISO()}T12:00:00`).toISOString();
      const payload = {
        action_no: form.action_no || null,
        line: form.line || null,
        shift: form.shift || null,
        leader_name: leader?.name ?? (form.leader_name || null),
        sku: form.sku || null,
        batch: form.batch || null,
        department: form.department || null,
        status: form.status,
        severity: form.severity || null,
        labels: form.labels,
        description: form.description || null,
        recorded_at,
      };
      if (editingId) {
        const { error } = await supabase.from("quality_actions").update(payload as never).eq("id", editingId);
        if (error) throw error;
      } else {
        const { data: u } = await supabase.auth.getUser();
        const { error } = await supabase.from("quality_actions").insert({
          ...payload, action_type_id: null, leader_id: null, points: 1, recorded_by: u.user?.id ?? null,
        } as never);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quality_actions"] });
      const wasEdit = !!editingId;
      setOpen(false); setForm(makeEmptyForm()); setEditingId(null);
      toast.success(wasEdit ? "Saved" : "Logged");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Auto-pull leader / SKU / batch from the production data once line + date + shift are set.
  // The supervisor only corrects what's wrong afterwards.
  useEffect(() => {
    if (!open || !form.line || !form.date || !form.shift) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: sess } = await supabase
          .from("production_sessions")
          .select("id, leader_name")
          .eq("line", form.line)
          .eq("session_date", form.date)
          .eq("shift", form.shift)
          .maybeSingle();
        if (cancelled || !sess) return;
        let sku = "";
        let batch = "";
        const { data: items } = await (supabase as any)
          .from("production_items")
          .select("batch_code, blender_ref, sku_code_text, sku_id")
          .eq("session_id", (sess as any).id)
          .order("created_at", { ascending: false })
          .limit(1);
        const it = (items ?? [])[0];
        if (it) { batch = it.batch_code ?? it.blender_ref ?? ""; sku = await resolveSkuCode(it); }
        if (cancelled) return;
        const leaderName = (sess as any).leader_name ?? "";
        const matched = leaders.find((l) => l.name === leaderName);
        setForm((f) => ({
          ...f,
          leader_name: leaderName || f.leader_name,
          leader_id: matched?.id ?? f.leader_id,
          sku: sku || f.sku,
          batch: batch || f.batch,
        }));
      } catch { /* auto-fill is best-effort */ }
    })();
    return () => { cancelled = true; };
  }, [open, form.line, form.date, form.shift, leaders]);

  // As soon as a batch code is typed, pull the SKU from production (by batch/blender_ref).
  // If the operator hasn't logged that batch yet, the action still saves with the batch and
  // the SKU is back-filled automatically once the production is entered (DB trigger).
  useEffect(() => {
    if (!open || !form.batch.trim()) return;
    const t = setTimeout(async () => {
      try {
        const b = form.batch.trim();
        const { data } = await (supabase as any)
          .from("production_items")
          .select("sku_code_text, sku_id")
          .or(`batch_code.eq.${b},blender_ref.eq.${b}`)
          .order("created_at", { ascending: false })
          .limit(1);
        const it = (data ?? [])[0];
        const sku = it ? await resolveSkuCode(it) : "";
        if (sku) setForm((f) => ({ ...f, sku }));
      } catch { /* best-effort */ }
    }, 400);
    return () => clearTimeout(t);
  }, [open, form.batch]);

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("quality_actions").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["quality_actions"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  /**
   * The verdict. Separate from `status` (the kanban column) because they answer
   * different questions: where the work is, versus whether the deviation is real.
   * Only "validated" costs a leader points, and the database refuses it from anyone
   * outside Quality or without evidence attached — the error surfaces here.
   */
  const setValidation = useMutation({
    mutationFn: async ({ id, validation_status }: { id: string; validation_status: string }) => {
      const { error } = await supabase.from("quality_actions").update({ validation_status } as never).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quality_actions"] });
      // The leader scorecard reads the verdict, so it has to be told.
      qc.invalidateQueries({ queryKey: ["ls_actions"] });
      toast.success("Validation updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /**
   * Closure — the manager's approval to file the matter, separate from Quality's
   * verdict. The database refuses it from anyone else, refuses it before there is a
   * verdict, and refuses a verdict change while it stands; those errors surface here.
   */
  const setClosure = useMutation({
    mutationFn: async ({ id, close }: { id: string; close: boolean }) => {
      const { error } = await supabase.from("quality_actions")
        .update({ closed_at: close ? new Date().toISOString() : null } as never)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["quality_actions"] });
      qc.invalidateQueries({ queryKey: ["ls_actions"] });
      toast.success(v.close ? "Action closed" : "Action reopened");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setSeverity = useMutation({
    mutationFn: async ({ id, severity }: { id: string; severity: string | null }) => {
      const { error } = await supabase.from("quality_actions").update({ severity }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["quality_actions"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteAction = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("quality_actions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["quality_actions"] }); toast.success("Action deleted"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const exportRows = () => {
    const header = ["Date", "Action #", "Status", "Severity", "Points", "Line", "Shift", "Leader", "Department", "SKU", "Batch", "Labels", "Notes"];
    const body = filtered.map((a) => [
      a.recorded_at, a.action_no ?? "", statusMeta(a.status).label, severityMeta(a.severity)?.label ?? "",
      String(severityPoints(a.severity)),
      a.line ?? "", a.shift ?? "", a.leader_name ?? "", a.department ?? "", a.sku ?? "", a.batch ?? "",
      (a.labels ?? []).join("; "), a.description ?? "",
    ]);
    return { header, body };
  };

  const exportCSV = () => {
    const { header, body } = exportRows();
    const csv = [header, ...body].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `quality-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const reportInput = () => ({
    actions: filtered.map((a) => ({
      recorded_at: a.recorded_at, action_no: a.action_no, status: a.status, severity: a.severity,
      line: a.line, shift: a.shift, leader_name: a.leader_name, department: a.department,
      sku: a.sku, batch: a.batch, labels: a.labels, description: a.description,
      validation_status: a.validation_status, closed_at: a.closed_at,
    })),
    periodLabel,
    generatedBy: profile?.name || "—",
  });
  const printPDF = () => { generateQualityReportPDF(reportInput()).catch(() => toast.error("Could not generate PDF")); };
  const fullExcel = () => { try { generateQualityReportExcel(reportInput()); } catch { toast.error("Could not generate Excel"); } };

  // One-tap report of TODAY's actions, independent of the date-range filter —
  // it queries today directly so it's right even if the filter is on a past range.
  const printDaily = async () => {
    // "Today" is the factory's day, not the calendar's: at 02:00 the night crew is
    // still working the day before, and the report they ask for is theirs.
    const day = getCurrentFactoryShift().sessionDate;
    try {
      const window = shiftDateFetchRange(day, day);
      const { data, error } = await supabase.from("quality_actions").select("*")
        .gte("recorded_at", window.gte).lte("recorded_at", window.lte)
        .order("recorded_at", { ascending: false });
      if (error) throw error;
      const rows = ((data ?? []) as unknown as QualityAction[])
        .filter((a) => shiftSessionDate(a.recorded_at, a.shift) === day);
      if (rows.length === 0) { toast.info("No quality actions logged today"); return; }
      await generateQualityReportPDF({
        actions: rows.map((a) => ({
          recorded_at: a.recorded_at, action_no: a.action_no, status: a.status, severity: a.severity,
          line: a.line, shift: a.shift, leader_name: a.leader_name, department: a.department,
          sku: a.sku, batch: a.batch, labels: a.labels, description: a.description,
        })),
        periodLabel: `Daily report · ${format(new Date(), "dd/MM/yyyy")}`,
        generatedBy: profile?.name || "—",
      });
    } catch { toast.error("Could not generate the daily report"); }
  };

  return (
    <div className="space-y-6">
        <div className="flex items-center justify-end flex-wrap gap-3">
          <div className="flex flex-wrap gap-2">
            <div className="inline-flex rounded-md border p-0.5">
              <button type="button" onClick={() => setView("list")} className={cn("inline-flex items-center gap-1 rounded px-3 py-1 text-sm font-medium transition-colors", view === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                <List className="h-4 w-4" /> List
              </button>
              <button type="button" onClick={() => setView("analytics")} className={cn("inline-flex items-center gap-1 rounded px-3 py-1 text-sm font-medium transition-colors", view === "analytics" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                <BarChart3 className="h-4 w-4" /> Analytics
              </button>
            </div>
            {canManage && <Button variant="outline" onClick={() => setListsOpen(true)}><Tags className="h-4 w-4 mr-1" />Lists</Button>}
            {canManage && <Button variant="outline" onClick={() => setImportOpen(true)}><Upload className="h-4 w-4 mr-1" />Import</Button>}
            <Button variant="outline" onClick={printDaily}><Printer className="h-4 w-4 mr-1" />Daily report</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline"><Download className="h-4 w-4 mr-1" />Export</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={printPDF}>Print report (PDF)</DropdownMenuItem>
                <DropdownMenuItem onClick={fullExcel}>Excel report (.xlsx)</DropdownMenuItem>
                <DropdownMenuItem onClick={exportCSV}>Raw data (.csv)</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setEditingId(null); setForm(makeEmptyForm()); } }}>
              <DialogTrigger asChild><Button onClick={() => { setEditingId(null); setForm(makeEmptyForm()); }}><Plus className="h-4 w-4 mr-1" />Log action</Button></DialogTrigger>
              <DialogContent className="max-h-[90vh] overflow-y-auto">
                <DialogHeader><DialogTitle>{editingId ? "Edit quality action" : "Log quality action"}</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div><Label>Severity</Label>
                    <Select value={form.severity || "__none__"} onValueChange={(v) => setForm({ ...form, severity: v === "__none__" ? "" : v })}>
                      <SelectTrigger><SelectValue placeholder="Pick severity" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— None —</SelectItem>
                        {QUALITY_SEVERITIES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="min-w-0"><Label>Line</Label>
                      <Select value={form.line} onValueChange={(v) => setForm({ ...form, line: v })}>
                        <SelectTrigger><SelectValue placeholder="Pick line" /></SelectTrigger>
                        <SelectContent>{lineOptions.map((l) => <SelectItem key={l.name} value={l.name}>{l.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="min-w-0"><Label>Date</Label>
                      <Input type="date" className="w-full min-w-0" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
                    </div>
                    <div className="min-w-0"><Label>Shift</Label>
                      <Select value={form.shift} onValueChange={(v) => setForm({ ...form, shift: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="DAY">Day</SelectItem><SelectItem value="NIGHT">Night</SelectItem></SelectContent>
                      </Select>
                    </div>
                  </div>
                  <p className="-mt-1 text-2xs text-muted-foreground">Pick line, date &amp; shift — leader, SKU and batch fill in automatically. Correct anything that's wrong.</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Leader</Label>
                      <Select value={form.leader_id} onValueChange={(v) => setForm({ ...form, leader_id: v })}>
                        <SelectTrigger><SelectValue placeholder={form.leader_name || "Pick leader"} /></SelectTrigger>
                        <SelectContent>
                          {form.leader_name && !leaders.some((l) => l.name === form.leader_name) && (
                            <SelectItem value="__auto__">{form.leader_name} (from production)</SelectItem>
                          )}
                          {leaders.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div><Label>Department</Label>
                      <Select value={form.department} onValueChange={(v) => setForm({ ...form, department: v })}>
                        <SelectTrigger><SelectValue placeholder="Pick dept" /></SelectTrigger>
                        <SelectContent>{DEPTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>SKU</Label>
                      <Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="auto from production" />
                    </div>
                    <div><Label>Batch code</Label>
                      <Input value={form.batch} onChange={(e) => setForm({ ...form, batch: e.target.value })} placeholder="auto from production" />
                    </div>
                  </div>
                  <div>
                    <Label>Labels</Label>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {LABELS.map((l) => {
                        const on = form.labels.includes(l);
                        return (
                          <button key={l} type="button" onClick={() => toggleLabel(l)}
                            className={cn("rounded-full border px-2.5 py-1 text-xs transition-colors", on ? "border-primary bg-primary text-primary-foreground" : "bg-muted/40 hover:bg-accent")}>
                            {l}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div><Label>Notes</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
                </div>
                <DialogFooter><Button onClick={() => create.mutate()} disabled={create.isPending}>Save</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* KPIs. The To do / In progress / Complete counters are gone: they are the
            state of a working board, they change through the shift, and this screen is
            read by people asking what stands against whom. Status is still on every row
            in the Log, still editable there, and still in the filter bar. */}
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          <KpiCard
            label="Total actions"
            icon={<ClipboardCheck className="h-3.5 w-3.5" />}
            value={kpis.total} accent="blue"
            sublabel={`${kpis.totalPoints} points in range`}
          />
          <KpiCard
            label="Waiting on Quality"
            icon={<ClipboardCheck className="h-3.5 w-3.5" />}
            value={kpis.awaitingVerdict} accent="warning" toneValue
            sublabel="No verdict yet — no score moves"
            active={filterValidation === "__pending__"}
            onClick={() => setFilterValidation(filterValidation === "__pending__" ? "__all__" : "__pending__")}
          />
          <KpiCard
            label="Open points"
            icon={<ClipboardCheck className="h-3.5 w-3.5" />}
            value={kpis.openPoints} accent="purple"
            sublabel="Weight still outstanding"
          />
          <KpiCard
            label="High / Critical open"
            icon={<span className="h-2 w-2 rounded-full bg-destructive" />}
            value={kpis.openSevere} accent="danger"
            toneValue
            sublabel={kpis.ungraded ? `${kpis.ungraded} action${kpis.ungraded === 1 ? "" : "s"} with no severity` : "Every action graded"}
            active={filterSeverity === "high" || filterSeverity === "critical"}
            onClick={() => setFilterSeverity(filterSeverity === "critical" ? "__all__" : "critical")}
          />
        </div>

        <QualityTrackingByLeader actions={filtered} periodLabel={periodLabel} />

        <TopRecurringIssues actions={filtered} />

        {/* Filters, in a toolbar card like the Maintenance Orders screen. */}
        <div className="flex flex-wrap gap-2 rounded-lg border bg-muted/30 p-3">
          <DateRangeFilter value={drRange} preset={drPreset} onChange={(r, p) => { setDrRange(r); setDrPreset(p); }} storageKey={OPS_RANGE_KEY} />
          <Select value={filterSeverity} onValueChange={setFilterSeverity}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="__all__">All severity</SelectItem>{QUALITY_SEVERITIES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={filterValidation} onValueChange={setFilterValidation}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All validations</SelectItem>
              <SelectItem value="__pending__">Waiting on Quality</SelectItem>
              {VALIDATION_STATES.map((v) => <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterLine} onValueChange={setFilterLine}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="__all__">All Lines</SelectItem>{lineOptions.map((l) => <SelectItem key={l.name} value={l.name}>{l.name}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={filterDept} onValueChange={setFilterDept}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="__all__">All departments</SelectItem>{DEPTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={filterLeader} onValueChange={setFilterLeader}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="__all__">All leaders</SelectItem>{leaders.map((l) => <SelectItem key={l.id} value={l.name}>{l.name}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={filterShift} onValueChange={setFilterShift}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="__all__">All Shifts</SelectItem><SelectItem value="DAY">Day</SelectItem><SelectItem value="NIGHT">Night</SelectItem></SelectContent>
          </Select>
        </div>

        {view === "analytics" ? (
          <SectionErrorBoundary title="Quality analytics">
            <QualityAnalytics actions={filtered} from={from} />
          </SectionErrorBoundary>
        ) : isMobile ? (
          <Card>
            <CardHeader><CardTitle>Log ({filtered.length})</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {filtered.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No actions</p>}
              {filtered.map((a) => {
                const sev = severityMeta(a.severity);
                return (
                  <div key={a.id} role="button" tabIndex={0}
                    onClick={() => setDetailId(a.id)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDetailId(a.id); } }}
                    className="w-full cursor-pointer rounded-lg border p-3 text-left transition-colors hover:bg-accent/40 active:scale-[0.99]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-figure text-sm font-semibold">{a.action_no || <span className="font-sans font-normal italic text-muted-foreground/60">no #</span>}</span>
                      <div className="flex items-center gap-1">
                        <Badge variant="outline" className={cn("text-2xs", validationMeta(a.validation_status).badge)}>
                          {validationMeta(a.validation_status).label}
                        </Badge>
                        {isClosed(a) && (
                          <Badge variant="outline" className="border-success/40 bg-success/15 text-2xs text-success-strong">Closed</Badge>
                        )}
                        {canManage && (
                          <span onClick={(e) => e.stopPropagation()}>
                            <RowDeleteButton actionNo={a.action_no} onConfirm={() => deleteAction.mutate(a.id)} />
                          </span>
                        )}
                      </div>
                    </div>
                    {a.description && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{a.description}</p>}
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-muted-foreground">
                      <span className="whitespace-nowrap">{format(new Date(a.recorded_at), "dd/MM HH:mm")}</span>
                      {a.line && <span className="truncate">· {a.line}{a.leader_name ? ` · ${a.leader_name}` : ""}</span>}
                      {canManage ? (
                        <span onClick={(e) => e.stopPropagation()}>
                          <Select
                            value={a.severity || "__none__"}
                            onValueChange={(v) => setSeverity.mutate({ id: a.id, severity: v === "__none__" ? null : v })}
                          >
                            <SelectTrigger className={cn("h-7 w-28 border text-2xs", sev?.badge)}><SelectValue placeholder="Severity" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">—</SelectItem>
                              {QUALITY_SEVERITIES.map((x) => (
                                <SelectItem key={x.value} value={x.value}>{x.label} · {x.points}p</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </span>
                      ) : sev ? (
                        <Badge variant="outline" className={cn("text-2xs", sev.badge)}>{sev.label} · {sev.points}p</Badge>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader><CardTitle>Log ({filtered.length})</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>When</TableHead><TableHead>#</TableHead>
                  <TableHead>Validation</TableHead><TableHead>Severity</TableHead>
                  <TableHead className="text-right">Points</TableHead>
                  <TableHead>Line</TableHead><TableHead>Leader</TableHead>
                  <TableHead>Dept</TableHead><TableHead>Labels</TableHead><TableHead>Notes</TableHead>
                  {canManage && <TableHead className="w-10 text-right">Delete</TableHead>}
                </TableRow></TableHeader>
                <TableBody>
                  {filtered.length === 0 && <TableRow><TableCell colSpan={canManage ? 11 : 10} className="text-center text-muted-foreground">No actions</TableCell></TableRow>}
                  {filtered.map((a) => {
                    const sev = severityMeta(a.severity);
                    return (
                    <TableRow key={a.id} className="cursor-pointer" onClick={() => setDetailId(a.id)}>
                      <TableCell className="whitespace-nowrap">{format(new Date(a.recorded_at), "dd/MM HH:mm")}</TableCell>
                      <TableCell className="font-figure text-xs">{a.action_no ?? "—"}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Badge variant="outline" className={cn("text-2xs", validationMeta(a.validation_status).badge)}>
                            {validationMeta(a.validation_status).label}
                          </Badge>
                          {a.closed_at && (
                            <Badge variant="outline" className="border-success/40 bg-success/15 text-2xs text-success-strong">
                              Closed
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      {/* Editable inline, like Status. Severity drives the points
                          score, so re-grading had to be quicker than opening the
                          detail dialog for every row. */}
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        {canManage ? (
                          <Select
                            value={a.severity || "__none__"}
                            onValueChange={(v) => setSeverity.mutate({ id: a.id, severity: v === "__none__" ? null : v })}
                          >
                            <SelectTrigger className={cn("h-7 w-28 border text-xs", sev?.badge)}><SelectValue placeholder="—" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">—</SelectItem>
                              {QUALITY_SEVERITIES.map((x) => (
                                <SelectItem key={x.value} value={x.value}>{x.label} · {x.points}p</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : sev ? (
                          <Badge variant="outline" className={cn("text-2xs", sev.badge)}>{sev.label}</Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">{sev ? sev.points : <span className="font-normal text-muted-foreground">—</span>}</TableCell>
                      <TableCell>{a.line ?? "—"}</TableCell>
                      <TableCell>{a.leader_name ?? "—"}</TableCell>
                      <TableCell>{a.department ?? "—"}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {(a.labels ?? []).map((l) => <Badge key={l} variant="secondary" className="text-2xs">{l}</Badge>)}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-xs truncate">{a.description ?? "—"}</TableCell>
                      {canManage && (
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          <RowDeleteButton actionNo={a.action_no} onConfirm={() => deleteAction.mutate(a.id)} />
                        </TableCell>
                      )}
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        <QualityIssueDetail
          action={detailAction}
          canManage={canManage}
          onOpenChange={(o) => { if (!o) setDetailId(null); }}
          onStatus={(status) => detailAction && setStatus.mutate({ id: detailAction.id, status })}
          onSeverity={(severity) => detailAction && setSeverity.mutate({ id: detailAction.id, severity })}
          canValidate={canValidate}
          canClose={canClose}
          onValidation={(validation_status) => detailAction && setValidation.mutate({ id: detailAction.id, validation_status })}
          onClosure={(close) => detailAction && setClosure.mutate({ id: detailAction.id, close })}
          onDelete={() => { if (detailAction) { deleteAction.mutate(detailAction.id); setDetailId(null); } }}
          onEdit={() => { if (detailAction) openEdit(detailAction); }}
        />

        {canManage && (
          <Dialog open={listsOpen} onOpenChange={setListsOpen}>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Lists &amp; scoring</DialogTitle></DialogHeader>
              <SeverityPointsEditor />
              <LeaderScoreWeightsEditor />
              <QualityListsManager />
            </DialogContent>
          </Dialog>
        )}

        {canManage && (
          <QualityImportDialog
            open={importOpen}
            onOpenChange={setImportOpen}
            types={types}
            onImported={() => qc.invalidateQueries({ queryKey: ["quality_actions"] })}
          />
        )}
      </div>
  );
}


function IssueCard({ a, canManage, onOpen, onMove }: {
  a: QualityAction; canManage: boolean;
  onOpen: (id: string) => void; onMove: (id: string, status: string) => void;
}) {
  const sev = severityMeta(a.severity);
  const nPhotos = a.attachments?.length ?? 0;
  return (
    <div
      draggable={canManage}
      onDragStart={(e) => { e.dataTransfer.setData("text/plain", a.id); e.dataTransfer.effectAllowed = "move"; }}
      onClick={() => onOpen(a.id)}
      className={cn("rounded-md border bg-background p-2.5 shadow-sm transition-colors hover:bg-accent/50", canManage ? "cursor-grab active:cursor-grabbing" : "cursor-pointer", sev?.accent ?? "border-l-[3px] border-l-transparent")}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-figure text-xs font-semibold text-foreground">{a.action_no || <span className="font-sans font-normal italic text-muted-foreground/60">no #</span>}</span>
        {sev && (
          <Badge variant="outline" className={cn("text-2xs", sev.badge)} title={`${sev.label} — ${sev.points} point${sev.points === 1 ? "" : "s"}`}>
            {sev.label} · {sev.points}p
          </Badge>
        )}
      </div>
      {a.description && <p className="mt-1 line-clamp-2 text-xs">{a.description}</p>}
      {(a.sku || a.batch) && (
        <div className="mt-1.5 flex flex-wrap gap-1 text-2xs">
          {a.sku && <span className="rounded bg-muted px-1.5 py-0.5 font-figure text-muted-foreground">SKU {a.sku}</span>}
          {a.batch && <span className="rounded bg-muted px-1.5 py-0.5 font-figure text-muted-foreground">Batch {a.batch}</span>}
        </div>
      )}
      {(a.labels?.length ?? 0) > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {(a.labels ?? []).slice(0, 4).map((l) => <Badge key={l} variant="secondary" className="text-2xs">{l}</Badge>)}
        </div>
      )}
      <div className="mt-1.5 flex items-center justify-between text-2xs text-muted-foreground">
        <span className="truncate">{a.line ?? "—"}{a.leader_name ? ` · ${a.leader_name}` : ""}</span>
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          {nPhotos > 0 && <span className="inline-flex items-center gap-0.5"><Camera className="h-3 w-3" />{nPhotos}</span>}
          {format(new Date(a.recorded_at), "dd/MM")}
        </span>
      </div>
    </div>
  );
}

// ============================================================
// Issue detail — photos + audit history
// ============================================================
function DetailMeta({ label, value }: { label: string; value: string | null | undefined }) {
  return <div><span className="text-muted-foreground">{label}: </span>{value || "—"}</div>;
}

function describeHistory(h: QualityHistoryRow): string {
  if (h.field === "created") return "Issue created";
  if (h.field === "status") return `Status: ${statusMeta(h.old_value).label} → ${statusMeta(h.new_value).label}`;
  if (h.field === "severity") return `Severity: ${severityMeta(h.old_value)?.label ?? "None"} → ${severityMeta(h.new_value)?.label ?? "None"}`;
  return `${h.field}: ${h.old_value ?? "—"} → ${h.new_value ?? "—"}`;
}

function PhotoThumb({ path, canDelete, onDelete }: { path: string; canDelete: boolean; onDelete: () => void }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let ok = true;
    getQualityPhotoUrl(path).then((u) => { if (ok) setUrl(u); });
    return () => { ok = false; };
  }, [path]);
  return (
    <div className="group relative aspect-square overflow-hidden rounded border bg-muted">
      {url
        ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="Quality issue attachment" className="h-full w-full object-cover" /></a>
        : <div className="flex h-full items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>}
      {canDelete && (
        <button type="button" onClick={onDelete}
          className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white opacity-0 transition-opacity group-hover:opacity-100">
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

function QualityIssueDetail({ action, canManage, canValidate, canClose, onOpenChange, onStatus, onSeverity, onValidation, onClosure, onDelete, onEdit }: {
  action: QualityAction | null; canManage: boolean;
  onOpenChange: (open: boolean) => void; onStatus: (status: string) => void; onSeverity: (severity: string | null) => void;
  canValidate: boolean;
  canClose: boolean;
  onValidation: (validation_status: string) => void;
  onClosure: (close: boolean) => void;
  onDelete: () => void; onEdit: () => void;
}) {
  const { data: history = [] } = useQualityHistory(action?.id);
  const upload = useUploadQualityPhoto();
  const del = useDeleteQualityPhoto();
  const fileRef = useRef<HTMLInputElement>(null);
  const attachments = action?.attachments ?? [];

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f && action) {
      upload.mutate(
        { actionId: action.id, file: f, current: attachments },
        { onError: (err) => toast.error((err as Error).message) },
      );
    }
    e.target.value = "";
  };

  return (
    <Dialog open={!!action} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        {action && (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <span className="font-figure text-sm">{action.action_no ?? "Issue"}</span>
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Severity</Label>
                  <Select value={action.severity || "__none__"} onValueChange={(v) => onSeverity(v === "__none__" ? null : v)} disabled={!canManage}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— None —</SelectItem>
                      {QUALITY_SEVERITIES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Validation — the audit-facing decision. */}
              <div>
                <Label>Validation</Label>
                <Select value={action.validation_status ?? "open"} onValueChange={onValidation} disabled={!canValidate}>
                  <SelectTrigger className={cn("border", validationMeta(action.validation_status).badge)}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {VALIDATION_STATES.map((v) => <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-2xs text-muted-foreground">
                  {canValidate
                    ? validationMeta(action.validation_status).hint
                    : "Only Quality or an admin rules on a deviation. " + validationMeta(action.validation_status).hint}
                  {action.validated_at && ` · validated ${format(new Date(action.validated_at), "dd/MM/yyyy HH:mm")}`}
                </p>
                {canValidate && attachments.length === 0 && action.validation_status !== "validated" && (
                  <p className="mt-1 text-2xs text-warning-strong">
                    Attach the evidence first — validating without it is refused.
                  </p>
                )}

                {/* Closure — the manager's approval, separate from the verdict. */}
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border p-2">
                  {action.closed_at ? (
                    <>
                      <Badge variant="outline" className="bg-success/15 text-success-strong border-success/40 text-2xs">
                        Closed {format(new Date(action.closed_at), "dd/MM/yyyy HH:mm")}
                      </Badge>
                      <span className="text-2xs text-muted-foreground">The verdict cannot change until it is reopened.</span>
                      {canClose && <Button size="sm" variant="outline" className="ml-auto" onClick={() => onClosure(false)}>Reopen</Button>}
                    </>
                  ) : (
                    <>
                      <span className="text-2xs text-muted-foreground">
                        {["validated", "rejected"].includes(action.validation_status ?? "")
                          ? "Ready for a manager to approve the closure."
                          : "Quality has to validate or reject this before it can be closed."}
                      </span>
                      {canClose && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="ml-auto"
                          disabled={!["validated", "rejected"].includes(action.validation_status ?? "")}
                          onClick={() => onClosure(true)}
                        >
                          Approve closure
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <DetailMeta label="Line" value={action.line} />
                <DetailMeta label="Shift" value={action.shift} />
                <DetailMeta label="Leader" value={action.leader_name} />
                <DetailMeta label="Department" value={action.department} />
                <DetailMeta label="Logged" value={format(new Date(action.recorded_at), "dd/MM/yyyy HH:mm")} />
              </div>

              {(action.labels?.length ?? 0) > 0 && (
                <div className="flex flex-wrap gap-1">{(action.labels ?? []).map((l) => <Badge key={l} variant="secondary" className="text-2xs">{l}</Badge>)}</div>
              )}
              {action.description && <p className="whitespace-pre-wrap rounded border bg-muted/30 p-2 text-sm">{action.description}</p>}

              {/* Photos */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <Label className="flex items-center gap-1"><Camera className="h-4 w-4" /> Photos ({attachments.length})</Label>
                  {canManage && (
                    <>
                      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPick} />
                      <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={upload.isPending}>
                        {upload.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Camera className="mr-1 h-4 w-4" />}Add photo
                      </Button>
                    </>
                  )}
                </div>
                {attachments.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No photos.</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {attachments.map((p) => (
                      <PhotoThumb key={p} path={p} canDelete={canManage}
                        onDelete={() => del.mutate({ actionId: action.id, path: p, current: attachments }, { onError: (e) => toast.error((e as Error).message) })} />
                    ))}
                  </div>
                )}
              </div>

              {/* History */}
              <div>
                <Label className="flex items-center gap-1"><Clock className="h-4 w-4" /> History</Label>
                <div className="mt-1.5 space-y-1.5">
                  {history.length === 0 && <p className="text-xs text-muted-foreground">No history yet.</p>}
                  {history.map((h) => (
                    <div key={h.id} className="flex items-start gap-2 text-xs">
                      <span className="whitespace-nowrap text-muted-foreground">{format(new Date(h.changed_at), "dd/MM HH:mm")}</span>
                      <span>{describeHistory(h)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {canManage && (
                <div className="flex items-center justify-between border-t pt-3">
                  <Button variant="outline" size="sm" onClick={onEdit}>
                    <Pencil className="h-4 w-4 mr-1" /> Edit action
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm" className="text-destructive-strong hover:text-destructive-strong">
                        <Trash2 className="h-4 w-4 mr-1" /> Delete action
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete this action?</AlertDialogTitle>
                        <AlertDialogDescription>
                          {action.action_no ? `Action ${action.action_no}` : "This action"} will be permanently removed. This cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={onDelete}>Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}


/**
 * How the leader's final score is weighted.
 *
 * A management judgement, not a technical constant — the same reason severity points
 * live in the database. The three must total 100, and the database refuses anything
 * else, so a half-finished edit cannot leave every leader's score quietly rescaled.
 */
function LeaderScoreWeightsEditor() {
  const { data: weights } = useLeaderScoreWeights();
  const save = useUpdateLeaderScoreWeights();
  const [draft, setDraft] = useState<LeaderScoreWeights | null>(null);
  const current = draft ?? weights ?? DEFAULT_WEIGHTS;
  const total = current.production_pct + current.quality_pct + current.documentation_pct;
  const dirty = !!draft && !!weights && (
    draft.production_pct !== weights.production_pct ||
    draft.quality_pct !== weights.quality_pct ||
    draft.documentation_pct !== weights.documentation_pct
  );

  const set = (k: keyof LeaderScoreWeights, v: string) =>
    setDraft({ ...current, [k]: Math.max(0, Math.min(100, Math.round(Number(v) || 0))) });

  return (
    <div className="space-y-3 border-b pb-4">
      <div>
        <h3 className="text-sm font-semibold">Leader score weights</h3>
        <p className="text-xs text-muted-foreground">
          How production, quality and documentation combine into the leader's final score. The three must add up to 100.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {([
          ["production_pct", "Production"],
          ["quality_pct", "Quality"],
          ["documentation_pct", "Documentation"],
        ] as const).map(([key, label]) => (
          <div key={key} className="space-y-1">
            <Label className="text-xs">{label}</Label>
            <Input
              type="number" min={0} max={100} inputMode="numeric"
              className="tabular-nums"
              value={String(current[key])}
              onChange={(e) => set(key, e.target.value)}
              aria-label={`${label} weight`}
            />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={!dirty || total !== 100 || save.isPending}
          onClick={() => save.mutate(current, {
            onSuccess: () => { setDraft(null); toast.success("Weights updated"); },
            onError: (e: any) => toast.error(e?.message ?? "Could not save the weights"),
          })}
        >
          {save.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Save weights
        </Button>
        <span className={cn("text-xs", total === 100 ? "text-muted-foreground" : "text-destructive-strong")}>
          Total {total}%{total !== 100 ? " — must be 100" : ""}
        </span>
        {dirty && <Button size="sm" variant="ghost" onClick={() => setDraft(null)} disabled={save.isPending}>Reset</Button>}
      </div>
    </div>
  );
}

/**
 * What each severity is worth.
 *
 * The weights were constants in the source — Low 1, Medium 2, High 3, Critical 4 —
 * so changing how quality is scored needed a developer and a deploy. Quality owns
 * that judgement.
 *
 * Changing a weight re-scores the whole history, because points are derived from
 * severity rather than stored on the action. That is stated on screen: it is the
 * behaviour people need to know before they change a number.
 */
function SeverityPointsEditor() {
  const { data: rows, isLoading } = useSeverityPointRows();
  const save = useUpdateSeverityPoints();
  const [draft, setDraft] = useState<Record<string, string>>({});

  const value = (sev: string, current: number) => draft[sev] ?? String(current);
  const dirty = !!rows?.some((r) => draft[r.severity] !== undefined && Number(draft[r.severity]) !== r.points);

  const commit = () => {
    if (!rows) return;
    const next = rows.map((r) => {
      const raw = draft[r.severity];
      const n = raw === undefined ? r.points : Math.max(0, Math.min(1000, Math.round(Number(raw) || 0)));
      return { severity: r.severity, points: n };
    });
    save.mutate(next, {
      onSuccess: () => { setDraft({}); toast.success("Severity points updated"); },
      onError: (e: any) => toast.error(e?.message ?? "Could not save the points"),
    });
  };

  return (
    <div className="space-y-3 border-b pb-4">
      <div>
        <h3 className="text-sm font-semibold">Severity points</h3>
        <p className="text-xs text-muted-foreground">
          Used for column totals, the leader scorecard and Analytics. Changing a weight re-scores
          past actions too — the score always follows the severity on the card.
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(rows ?? []).map((r) => {
            const meta = severityMeta(r.severity);
            return (
              <div key={r.severity} className="space-y-1">
                <Label className="flex items-center gap-1.5 text-xs">
                  <Badge variant="outline" className={cn("px-1.5 py-0 text-2xs", meta?.badge)}>{meta?.label ?? r.severity}</Badge>
                </Label>
                <Input
                  type="number"
                  min={0}
                  max={1000}
                  inputMode="numeric"
                  value={value(r.severity, r.points)}
                  onChange={(e) => setDraft((d) => ({ ...d, [r.severity]: e.target.value }))}
                  className="tabular-nums"
                  aria-label={`Points for ${meta?.label ?? r.severity}`}
                />
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={commit} disabled={!dirty || save.isPending}>
          {save.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Save points
        </Button>
        {dirty && (
          <Button size="sm" variant="ghost" onClick={() => setDraft({})} disabled={save.isPending}>Reset</Button>
        )}
      </div>
    </div>
  );
}

function QualityListsManager() {
  const qc = useQueryClient();
  const { data: options = [] } = useAllQualityOptions();
  const [kind, setKind] = useState<"label" | "department">("label");
  const [value, setValue] = useState("");

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["quality_options_all"] });
    qc.invalidateQueries({ queryKey: ["quality_options"] });
  };

  const add = async () => {
    const v = value.trim();
    if (!v) return;
    const maxSort = options.filter((o) => o.kind === kind).reduce((m, o) => Math.max(m, o.sort), 0);
    const { error } = await supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types yet
      .from("quality_options" as any)
      .insert({ kind, value: v, sort: maxSort + 1, active: true } as unknown as never);
    if (error) { toast.error(error.message); return; }
    setValue(""); refresh();
  };
  const toggle = async (o: QualityOption) => {
    const { error } = await supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types yet
      .from("quality_options" as any)
      .update({ active: !o.active } as unknown as never)
      .eq("id", o.id);
    if (error) { toast.error(error.message); return; }
    refresh();
  };
  const remove = async (o: QualityOption) => {
    const { error } = await supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types yet
      .from("quality_options" as any)
      .delete()
      .eq("id", o.id);
    if (error) { toast.error(error.message); return; }
    refresh();
  };

  const groups: { kind: "label" | "department"; title: string }[] = [
    { kind: "label", title: "Labels" },
    { kind: "department", title: "Departments" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Select value={kind} onValueChange={(v) => setKind(v as "label" | "department")}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="label">Label</SelectItem><SelectItem value="department">Department</SelectItem></SelectContent>
        </Select>
        <Input placeholder="New value..." value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <Button onClick={add}>Add</Button>
      </div>
      {groups.map((g) => (
        <div key={g.kind}>
          <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{g.title}</p>
          <div className="divide-y rounded border">
            {options.filter((o) => o.kind === g.kind).length === 0 && (
              <p className="px-3 py-2 text-sm text-muted-foreground">None yet.</p>
            )}
            {options.filter((o) => o.kind === g.kind).map((o) => (
              <div key={o.id} className="flex items-center justify-between px-3 py-1.5">
                <span className={cn("text-sm", !o.active && "text-muted-foreground line-through")}>{o.value}</span>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => toggle(o)}>{o.active ? "Hide" : "Show"}</Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive-strong"><Trash2 className="h-4 w-4" /></Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remove "{o.value}"?</AlertDialogTitle>
                        <AlertDialogDescription>This removes the option from the list. You can add it again later.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => remove(o)}>Remove</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}


/**
 * What keeps coming back.
 *
 * Grouped on the description as typed, which is why near-duplicates ("metal on
 * magnet" and "Metal found on magnet check") count separately — the alternative is
 * guessing that two sentences mean the same thing, and a board that silently merges
 * two problems is worse than one that lists them twice.
 *
 * Severity points, not just a count: ten Low actions and one Critical are not the
 * same problem, and the count alone said they were.
 */
function TopRecurringIssues({ actions }: { actions: QualityAction[] }) {
  const rows = useMemo(() => {
    const m = new Map<string, { text: string; count: number; points: number; lines: Set<string> }>();
    for (const a of actions) {
      const text = (a.description ?? "").trim();
      if (!text) continue;
      const key = text.toLowerCase().slice(0, 80);
      const e = m.get(key) ?? { text, count: 0, points: 0, lines: new Set<string>() };
      e.count += 1;
      e.points += severityPoints(a.severity);
      if (a.line) e.lines.add(a.line);
      m.set(key, e);
    }
    return Array.from(m.values())
      .filter((r) => r.count >= 2)
      .sort((a, b) => b.count - a.count || b.points - a.points)
      .slice(0, 5);
  }, [actions]);

  if (rows.length === 0) return null;

  return (
    <Card className="break-inside-avoid">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold uppercase tracking-wide">Top recurring issues</CardTitle>
        <CardDescription>Raised more than once in this period. One occurrence is an incident, not a pattern.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.text} className="flex items-center gap-3 rounded border p-2 text-xs">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{r.text}</span>
              <span className="block truncate text-2xs text-muted-foreground">
                {r.lines.size ? Array.from(r.lines).join(", ") : "No line recorded"}
              </span>
            </span>
            <span className="shrink-0 font-figure font-bold">{r.count}×</span>
            <span className="shrink-0 font-figure text-2xs text-muted-foreground">{r.points} pts</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ============================================================
// Analytics
// ============================================================
function QualityAnalytics({ actions, from }: { actions: QualityAction[]; from: string }) {
  const byDay = useMemo(() => {
    const m = new Map<string, { key: string; label: string; todo: number; in_progress: number; complete: number }>();
    for (const a of actions) {
      const d = new Date(a.recorded_at);
      const key = format(d, "yyyy-MM-dd");
      const cur = m.get(key) ?? { key, label: format(d, "dd/MM"), todo: 0, in_progress: 0, complete: 0 };
      const s = (a.status === "in_progress" || a.status === "complete") ? a.status : "todo";
      cur[s] += 1;
      m.set(key, cur);
    }
    return Array.from(m.values()).sort((a, b) => a.key.localeCompare(b.key));
  }, [actions]);

  const byLabel = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of actions) for (const l of a.labels ?? []) m.set(l, (m.get(l) ?? 0) + 1);
    return Array.from(m.entries()).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
  }, [actions]);

  const byDept = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of actions) { const d = a.department ?? "—"; m.set(d, (m.get(d) ?? 0) + 1); }
    return Array.from(m.entries()).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
  }, [actions]);

  const [leaderSearch, setLeaderSearch] = useState("");
  const byLeader = useMemo(() => {
    const m = new Map<string, { count: number; points: number; critical: number; high: number }>();
    for (const a of actions) {
      const l = a.leader_name?.trim() || "—";
      const cur = m.get(l) ?? { count: 0, points: 0, critical: 0, high: 0 };
      cur.count += 1;
      cur.points += severityPoints(a.severity);
      if (a.severity === "critical") cur.critical += 1;
      else if (a.severity === "high") cur.high += 1;
      m.set(l, cur);
    }
    // Ranked by points, not raw count: ten Lows must not outrank three Criticals.
    return Array.from(m.entries())
      .map(([label, v]) => ({ label, ...v }))
      .sort((a, b) => b.points - a.points || b.count - a.count);
  }, [actions]);
  const filteredLeaders = useMemo(() => {
    const q = leaderSearch.trim().toLowerCase();
    const list = q ? byLeader.filter((l) => l.label.toLowerCase().includes(q)) : byLeader;
    return list.slice(0, 15);
  }, [byLeader, leaderSearch]);

  const gridStroke = "hsl(var(--border))";

  if (actions.length === 0) {
    return <Card><CardContent className="p-8 text-center text-muted-foreground">No actions in this period.</CardContent></Card>;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Actions by status over time</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={byDay} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
              <XAxis dataKey="label" fontSize={11} tickLine={false} />
              <YAxis fontSize={11} allowDecimals={false} tickLine={false} />
              <Tooltip contentStyle={{ fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="todo" stackId="s" fill={statusMeta("todo").color} name="To do" />
              <Bar dataKey="in_progress" stackId="s" fill={statusMeta("in_progress").color} name="In progress" />
              <Bar dataKey="complete" stackId="s" fill={statusMeta("complete").color} name="Complete" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Leaderboard — who has the most actions */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <CardTitle className="text-base">Actions by leader <span className="text-xs font-normal text-muted-foreground">· ranked by points</span></CardTitle>
          <Input value={leaderSearch} onChange={(e) => setLeaderSearch(e.target.value)} placeholder="Search leader…" className="h-8 w-48" />
        </CardHeader>
        <CardContent>
          {filteredLeaders.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No leaders match “{leaderSearch}”.</p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={Math.max(160, filteredLeaders.length * 34)}>
                <BarChart data={filteredLeaders} layout="vertical" margin={{ top: 0, right: 24, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} horizontal={false} />
                  <XAxis type="number" allowDecimals={false} fontSize={11} tickLine={false} />
                  <YAxis type="category" dataKey="label" width={130} fontSize={11} tickLine={false} />
                  <Tooltip contentStyle={{ fontSize: 12 }} cursor={{ fill: "hsl(var(--muted))" }} />
                  <Bar dataKey="points" name="Points" fill="hsl(0 72% 51%)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <p className="mt-2 mb-1 text-2xs text-muted-foreground">
                Quality actions only. The full leader scorecard — production, quality and documentation — lives on
                Production Performance, which is where leaders are managed.
              </p>
              <div>
                {filteredLeaders.map((l, i) => (
                  <div key={l.label}
                    className="flex w-full items-center justify-between border-b py-1 text-left text-sm last:border-0">
                    <span className="truncate"><span className="mr-2 text-xs text-muted-foreground">#{i + 1}</span>{l.label}</span>
                    <span className="flex items-center gap-2 whitespace-nowrap">
                      {l.critical > 0 && <Badge variant="outline" className={cn("text-2xs", severityMeta("critical")?.badge)}>{l.critical} critical</Badge>}
                      {l.high > 0 && <Badge variant="outline" className={cn("text-2xs", severityMeta("high")?.badge)}>{l.high} high</Badge>}
                      <span className="text-xs text-muted-foreground tabular-nums" title={`${l.count} action${l.count === 1 ? "" : "s"}`}>{l.count}×</span>
                      <span className="font-semibold tabular-nums" title="Total points">{l.points} pts</span>
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Actions by label" data={byLabel} color="hsl(217 91% 60%)" />
        <ChartCard title="Actions by department" data={byDept} color="hsl(262 83% 58%)" />
      </div>

    </div>
  );
}

function ChartCard({ title, data, color }: { title: string; data: { label: string; count: number }[]; color: string }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No data</p>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(160, data.length * 34)}>
            <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
              <XAxis type="number" allowDecimals={false} fontSize={11} tickLine={false} />
              <YAxis type="category" dataKey="label" width={120} fontSize={11} tickLine={false} />
              <Tooltip contentStyle={{ fontSize: 12 }} cursor={{ fill: "hsl(var(--muted))" }} />
              <Bar dataKey="count" fill={color} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

