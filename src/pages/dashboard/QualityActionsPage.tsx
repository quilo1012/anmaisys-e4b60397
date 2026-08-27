import { useMemo, useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { writeOptionalDomain } from "@/lib/writeOptionalDomain";
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
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/ui/PageHeader";
import { DateRangeFilter, getPresetRange, type DateRange, type DateRangePreset } from "@/components/DateRangeFilter";
import { generateQualityReportPDF, generateQualityReportExcel } from "@/lib/qualityReport";
import { useAuth } from "@/contexts/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Download, List, BarChart3, Tags, Trash2, Upload, Clock, X, Loader2, ClipboardCheck, Printer, Pencil, ShieldCheck, MoreHorizontal, SlidersHorizontal, Scale, AlertTriangle, Repeat } from "lucide-react";
import { QualityImportDialog } from "@/components/QualityImportDialog";
import { SectionErrorBoundary } from "@/components/SectionErrorBoundary";
import { toast } from "sonner";
import { format } from "date-fns";
import { resolveReportRange, reportPeriodLabel } from "@/lib/reportRange";
import { getCurrentFactoryShift, shiftDateFetchRange, shiftSessionDate } from "@/lib/shifts";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";
import { isMissingColumn } from "@/lib/postgrestErrors";
import { QUALITY_LABELS, QUALITY_DEPARTMENTS, QUALITY_SEVERITIES, SAFETY_KINDS, SAFETY_KIND_GROUPS, isHarmKind, SAFETY_LABELS, labelsForDomain, statusMeta, severityMeta, safetyKindMeta, actionPoints, pointsBreakdown, sumActionPoints, severityPoints, severityPointsMap, labelPoints, logFormCharge, chargeSummary, excludedLabelNote, VALIDATION_STATES, validationMeta, isClosed, labelBadge, labelKindOf } from "@/lib/qualityConstants";
import { leaderPointsBreakdown, issueWeight } from "@/lib/qualityBreakdown";
import { useScoringFreeze } from "@/hooks/useScoringFreeze";
import { useGateLabels, useLabelKinds } from "@/hooks/useQualityOptions";
import { useLeaderAttribution, useSetLabelAttribution } from "@/hooks/useLabelAttribution";
import { useQualityOptions, useAllQualityOptions, useDepartmentAttribution, type QualityOption } from "@/hooks/useQualityOptions";
import { listGroups } from "@/lib/qualityListGroups";
import { railEdge } from "@/lib/rail";
import { useSeverityPointRows, useUpdateSeverityPoints } from "@/hooks/useSeverityPoints";
import { useLeaderScoreWeights, useUpdateLeaderScoreWeights } from "@/hooks/useLeaderScoreWeights";
import { DEFAULT_WEIGHTS, GATE_CAP, type LeaderScoreWeights } from "@/lib/leaderScore";
import { useRole } from "@/hooks/useRole";
import { useQualityHistory, type QualityHistoryRow } from "@/hooks/useQualityIssue";
import { KpiCard } from "@/components/reports/KpiCard";
import { QualityTrackingByLeader } from "@/components/quality/QualityTrackingByLeader";
import { ActionScore } from "@/components/quality/ActionScore";
import { OPS_RANGE_KEY } from "@/hooks/useOpsFilters";
import { filterByDomain, domainOf, safetyFormBlockers, type ActionDomainFilter } from "@/lib/actionDomain";
import { buildQualityActionPayload } from "@/lib/qualityActionPayload";

/**
 * Why a quality action's severity is not editable anywhere on this screen.
 *
 * Said in the same words in all three places that show it, so someone who reads it on
 * the table and again in the detail drawer does not have to work out whether they are
 * two different rules.
 */
const GRADE_FROM_LABELS = "Graded by its labels — change the labels to change the grade";

interface ActionType { id: string; code: string; label: string; points: number; active: boolean }
interface QualityAction {
  id: string; action_no: string | null; action_type_id: string; line: string | null; shift: string | null;
  leader_id?: string | null; leader_name: string | null; department: string | null; status: string; labels: string[] | null;
  description: string | null; recorded_at: string; points: number | null;
  severity: string | null; attachments: string[] | null;
  validation_status: string | null; validated_at: string | null; validated_by: string | null;
  closed_at: string | null; closed_by: string | null;
  sku: string | null; batch: string | null;
  domain?: string | null; safety_kind?: string | null;
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
// `domain` defaults to the tab the dialog was opened from — "Log action" from the
// Safety tab logs a safety occurrence, from the Quality (or All) tab a quality one.
const makeEmptyForm = (domain: "quality" | "safety" = "quality") => ({
  action_no: "", action_type_id: "", line: "", shift: "DAY", leader_id: "", leader_name: "",
  date: todayISO(), sku: "", batch: "",
  department: "", severity: "", labels: [] as string[], description: "",
  domain, safety_kind: "",
  // The leader_id already on the row being edited (null for a new insert) — see the
  // doc comment on QualityActionFormInput.original_leader_id for why this exists.
  original_leader_id: null as string | null,
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
  // `canValidate` and `canClose` were read here, for the verdict and the closure
  // controls in the detail dialog. Both controls are gone. A capability nothing renders
  // is how a dead control gets rebuilt, so they are not left standing: `quality.validate`
  // and `quality.close` are still in the permission matrix and the database triggers
  // still enforce them, and whatever writes a verdict next has to ask for them itself.
  const qc = useQueryClient();

  // Points on this screen are charged, so they wait for the attribution table. An
  // empty exclusion set means "everything counts", which is a real answer and not a
  // loading state — see useLeaderAttribution.
  const { excluded, ready: attributionReady } = useLeaderAttribution();

  const { data: qOpts } = useQualityOptions();
  const LABELS = qOpts?.labels ?? [...QUALITY_LABELS];
  const LABEL_LISTS = {
    labels: LABELS,
    safetyLabels: qOpts?.safetyLabels ?? [],
    // Appended to the quality form's chips by `labelsForDomain` — the same deviation
    // can be both a quality problem and a machine one, and is logged once.
    maintenanceLabels: qOpts?.maintenanceLabels ?? [],
  };
  // Which list each chip came from, for the colour it wears in the log below.
  const LABEL_KINDS = qOpts?.labelKinds ?? {};
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
  // Quality is the default tab: everything logged before this column existed is
  // quality (see filterByDomain), so opening the page must not appear to have lost
  // any of it behind a different tab.
  const [domainFilter, setDomainFilter] = useState<ActionDomainFilter>("quality");
  const [filterLine, setFilterLine] = useState("__all__");
  const [filterLeader, setFilterLeader] = useState("__all__");
  const [filterDept, setFilterDept] = useState("__all__");
  const [filterSeverity, setFilterSeverity] = useState("__all__");
  // "__pending__" is not a stored value — it is the question people actually ask of
  // this board: what is still waiting on Quality? Open and Under investigation both
  // answer it, and neither is findable by picking a single status.
  const [filterValidation, setFilterValidation] = useState("__all__");
  const [filterShift, setFilterShift] = useState("__all__");
  /**
   * `?action=<id>` opens that action's drawer on arrival.
   *
   * The leader scorecard lists the actions a leader is scored on, and until now that
   * list was dead text: the reader could see "GMP Non-Compliance, −4" and had no way
   * to reach the evidence, the history or the person who validated it. An audit
   * finding has to be followable to the record behind it, so the card links here.
   *
   * Read once, into initial state, rather than watched: the drawer is closable, and a
   * `useEffect` on the parameter would reopen it every render after the user shut it.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const [detailId, setDetailId] = useState<string | null>(() => searchParams.get("action"));
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
      // Carried through so saving never turns an already-linked row's leader_id into
      // null just because the stored name no longer matches an active leader.
      original_leader_id: a.leader_id ?? null,
      date: a.recorded_at ? a.recorded_at.slice(0, 10) : todayISO(),
      sku: a.sku ?? "",
      batch: a.batch ?? "",
      department: a.department ?? "",
      severity: a.severity ?? "",
      labels: a.labels ?? [],
      description: a.description ?? "",
      domain: a.domain === "safety" ? "safety" : "quality",
      safety_kind: a.safety_kind ?? "",
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
    filterByDomain(actions, domainFilter).filter((a) =>
      (filterLine === "__all__" || a.line === filterLine) &&
      (filterLeader === "__all__" || a.leader_name === filterLeader) &&
      (filterDept === "__all__" || a.department === filterDept) &&
      (filterSeverity === "__all__" || (a.severity ?? "") === filterSeverity) &&
      (filterShift === "__all__" || a.shift === filterShift) &&
      (filterValidation === "__all__" ||
        (filterValidation === "__pending__"
          ? !["validated", "rejected"].includes(a.validation_status ?? "open")
          : (a.validation_status ?? "open") === filterValidation))),
    [actions, domainFilter, filterLine, filterLeader, filterDept, filterSeverity, filterShift, filterValidation]
  );

  /**
   * The linked action, when it is not in the window the page happens to be showing.
   *
   * `actions` is bounded by the date filter, so a link to an action from last month
   * resolved to `null` and the drawer opened empty — a dead link that looked like a
   * deleted record. Rather than making the incoming link carry the period (and then
   * trusting a hand-edited date to be the right one), the page fetches the single row
   * it was asked for. Runs only when the id is not already on screen.
   */
  /**
   * Closing the drawer also drops `?action=` from the address — otherwise a reload, or
   * the back button, reopens a drawer the reader deliberately shut. `replace` so the
   * open and closed states are not two entries in the history.
   */
  const closeDetail = () => {
    setDetailId(null);
    if (searchParams.has("action")) {
      const next = new URLSearchParams(searchParams);
      next.delete("action");
      setSearchParams(next, { replace: true });
    }
  };

  const inWindow = useMemo(() => actions.find((a) => a.id === detailId) ?? null, [actions, detailId]);
  const { data: linkedAction = null } = useQuery({
    queryKey: ["quality_action_by_id", detailId],
    enabled: !!detailId && !inWindow,
    queryFn: async () => {
      const { data, error } = await supabase.from("quality_actions").select("*").eq("id", detailId as string).maybeSingle();
      if (error) throw error;
      return (data as unknown as QualityAction) ?? null;
    },
  });
  const detailAction = inWindow ?? linkedAction;

  // `filtered` with safety left out — for the two things safety must never rank on:
  // "who reported most" (QualityTrackingByLeader, the by-leader chart) and "what
  // keeps recurring" (Top recurring issues). On the Quality tab this is identical to
  // `filtered`; on Safety it is empty (those cards do not render there at all — see
  // below); on All it is the difference that keeps a near miss out of a ranking.
  const qualityOnly = useMemo(() => filtered.filter((a) => domainOf(a) !== "safety"), [filtered]);

  // Which of Points / Kind the Log table shows: Quality keeps just Points (unchanged),
  // Safety shows Kind instead (a safety row is never worth a number of points), and All
  // shows both side by side — see the Points cell below for why it reads "—" there.
  const showPointsColumn = domainFilter !== "safety";
  const showKindColumn = domainFilter !== "quality";
  // When, #, Line, Leader, Dept, Labels, Notes — seven fixed columns since Validation
  // and Severity came off. Wrong here and the "No actions" row stops spanning the table.
  const logColSpan = 7 + (showPointsColumn ? 1 : 0) + (showKindColumn ? 1 : 0) + (canManage ? 1 : 0);


  const kpis = useMemo(() => {
    // "Open" now means Quality has not filed it. The To do / In progress / Complete
    // board is gone; what remains is the lifecycle that carries a signature —
    // raised → validated or rejected → closed by a manager.
    const open = filtered.filter((x) => !isClosed(x));
    return {
      total: filtered.length,
      // Weighted, not counted: ten Low actions and one Critical are not the same
      // problem, and the counts alone said they were.
      // Charged, not just weighed: rejected actions and actions that are not the
      // leader's cost nothing here either, or this card and the leader table below
      // it would print two different totals for the same period.
      openPoints: sumActionPoints(open, excluded),
      totalPoints: sumActionPoints(filtered, excluded),
      openSevere: open.filter((x) => x.severity === "high" || x.severity === "critical").length,
      ungraded: filtered.filter((x) => !x.severity).length,
      // Safety's own answer to "how bad is this period", counted off the kind.
      //
      // The severity field came off the safety form: it charged nothing, it was graded
      // by hand, and the card that read it would now sit at 0 forever while people
      // logged injuries. Harm is the reading that replaces it, and it is the better
      // question anyway — an audit asks how many people were hurt, not how somebody
      // graded it. Counted over `filtered`, like `total` beside it: a lost-time injury
      // does not stop having happened once the paperwork is closed.
      harm: filtered.filter((x) => isHarmKind(x.safety_kind)).length,
      // Named separately because `scorecard_safety_counts` reports them as three
      // columns and never as a sum — the card should not be the one screen that
      // flattens them.
      harmBreakdown: (["lost_time_injury", "reportable_accident", "first_aid"] as const)
        .map((k) => ({ kind: k, n: filtered.filter((x) => x.safety_kind === k).length })),
      // Occurrences nobody classified. They are invisible to every count above and to
      // the whole H&S half of the weekly scorecard, so the card says so rather than
      // reporting a total that quietly excludes them.
      unclassified: filtered.filter((x) => domainOf(x) === "safety" && !x.safety_kind).length,
      // Counted over `actions`, not `filtered`: the moment the filter is set to
      // "Waiting on Quality" a count taken from the filtered rows would equal the
      // total and stop being an answer to anything.
      awaitingVerdict: actions.filter((x) => !["validated", "rejected"].includes(x.validation_status ?? "open")).length,
    };
  }, [filtered, actions, excluded]);

  // Filters, counted so the bar can offer a way out of them. The date range is not
  // counted: there is always one, and a "clear" that silently widened the period
  // would change every figure on the screen without being asked to.
  const activeFilters = [filterSeverity, filterValidation, filterLine, filterDept, filterLeader, filterShift]
    .filter((v) => v !== "__all__").length;
  const clearFilters = () => {
    setFilterSeverity("__all__"); setFilterValidation("__all__"); setFilterLine("__all__");
    setFilterDept("__all__"); setFilterLeader("__all__"); setFilterShift("__all__");
  };

  // Computed here, not inside the card, because whether there is a pattern to show
  // decides whether the row below is one column or two. Fed `qualityOnly`: a near
  // miss reported twice is not a recurring quality issue, and `issueWeight` prices
  // whatever it is given — the guard belongs at this call site, not inside it.
  const recurring = useMemo(() => recurringIssues(qualityOnly), [qualityOnly]);

  /**
   * Ticking a label is now the whole of what grades and prices a quality action.
   *
   * The form used to also carry the grade in `form.severity`, filled in from the
   * charge. It no longer needs to: `buildQualityActionPayload` derives the severity
   * from the labels on the way to the database, so there is exactly one rule and no
   * second copy to fall out of step with it. Safety keeps its own picked severity,
   * which this never touches.
   */
  const toggleLabel = (l: string) => {
    const labels = form.labels.includes(l) ? form.labels.filter((x) => x !== l) : [...form.labels, l];
    setForm((f) => ({ ...f, labels }));
  };

  const create = useMutation({
    mutationFn: async () => {
      const leader = leaders.find((l) => l.id === form.leader_id);
      const recorded_at = new Date(`${form.date || todayISO()}T12:00:00`).toISOString();
      // No `excluded` here any more. Attribution decides what an action CHARGES, never
      // what it IS: the grade is now the one the person picked. Save still waits for the
      // attribution table, because the charge shown beside the labels depends on it.
      const payload = buildQualityActionPayload(form, leader?.name ?? null, recorded_at);
      // `domain` and `safety_kind` arrive with 20260817090000, and PostgREST refuses
      // the whole write for one unknown column. A quality action is saved without
      // them; a safety one is refused rather than filed as a quality action. See
      // src/lib/writeOptionalDomain.ts for why those two are not the same case.
      if (editingId) {
        const { error } = await writeOptionalDomain(payload, (p) =>
          supabase.from("quality_actions").update(p as never).eq("id", editingId),
        );
        if (error) throw error;
      } else {
        const { data: u } = await supabase.auth.getUser();
        const insertPayload = { ...payload, action_type_id: null, recorded_by: u.user?.id ?? null };
        const { error } = await writeOptionalDomain(insertPayload, (p) =>
          supabase.from("quality_actions").insert(p as never),
        );
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

  // `setStatus` was removed here, with the last of the To do / In progress / Complete
  // machinery. An action is logged after it happened — the supervisor writes it down
  // because it already occurred — so there is no "not started" for it to be in. The
  // lifecycle that remains is the one an audit asks about and that carries a
  // signature: open → under investigation → validated or rejected → closed.
  //
  // The column itself stays in the database, NOT NULL DEFAULT 'todo' with a CHECK
  // (20260722120000). Nothing writes it any more; the default fills it on insert and
  // an edit leaves whatever a row already had, so no history is rewritten.

  // `setValidation` and `setClosure` were removed here, with the Validation block in
  // the detail dialog that was their only caller. Nothing in `src/` writes
  // `validation_status` or `closed_at` any more.
  //
  // Read what that costs before restoring either: `rejected` was the only verdict that
  // spared a leader the points for a deviation that was not theirs — a machine fault,
  // a supplier defect — so every action now charges in full (leaderScore.ts, and
  // `isRejected` in qualityConstants.ts). Closure needs a verdict this screen can no
  // longer give, so nothing closes. The columns and every value already in them are
  // untouched; the scorecard, the filters and the export still read them.

  // `setSeverity` was removed here. It existed for the safety rows, the only ones with
  // a severity anybody could still set by hand, and safety stopped being graded — a
  // quality action's grade has been derived from its labels since d9ff473d. A mutation
  // that writes a column no form collects is how the next stale grade gets in.

  const deleteAction = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("quality_actions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["quality_actions"] }); toast.success("Action deleted"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const exportRows = () => {
    // "Status" is gone from this file, and "Validation" takes its place rather than
    // its slot being dropped: a spreadsheet read away from the board has to say
    // whether Quality ruled on the deviation, which is the only state that moves a
    // score. Same position, so a saved import mapping shifts no other column.
    const header = ["Date", "Action #", "Validation", "Severity", "Points", "Kind", "Line", "Shift", "Leader", "Department", "SKU", "Batch", "Labels", "Notes"];
    const body = filtered.map((a) => {
      const isSafety = domainOf(a) === "safety";
      return [
        a.recorded_at, a.action_no ?? "", validationMeta(a.validation_status).label, severityMeta(a.severity)?.label ?? "",
        // What the action actually cost, not what its severity weighs. The export is
        // read next to the board, and a spreadsheet charging 4 for an action the board
        // shows as 0 is the same divergence again, just harder to spot.
        // A safety row gets an EMPTY cell, never "0": a written 0 in a file read away
        // from any screen that explains it reads as a claim ("this was worth
        // nothing"), and safety is never worth anything either way — see actionPoints().
        isSafety ? "" : String(actionPoints(a, excluded)),
        isSafety ? (safetyKindMeta(a.safety_kind)?.label ?? "") : "",
        a.line ?? "", a.shift ?? "", a.leader_name ?? "", a.department ?? "", a.sku ?? "", a.batch ?? "",
        (a.labels ?? []).join("; "), a.description ?? "",
      ];
    });
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
      recorded_at: a.recorded_at, action_no: a.action_no, severity: a.severity,
      line: a.line, shift: a.shift, leader_name: a.leader_name, department: a.department,
      sku: a.sku, batch: a.batch, labels: a.labels, description: a.description,
      validation_status: a.validation_status, closed_at: a.closed_at,
      domain: a.domain, safety_kind: a.safety_kind,
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
          recorded_at: a.recorded_at, action_no: a.action_no, severity: a.severity,
          line: a.line, shift: a.shift, leader_name: a.leader_name, department: a.department,
          sku: a.sku, batch: a.batch, labels: a.labels, description: a.description,
          // Never passed before. It did not show while the report printed `status`;
          // the moment the report started printing the verdict instead, every row of
          // the daily PDF would have read "Open" — including the ones Quality had
          // already validated that morning.
          validation_status: a.validation_status, closed_at: a.closed_at,
          domain: a.domain, safety_kind: a.safety_kind,
        })),
        periodLabel: `Daily report · ${format(new Date(), "dd/MM/yyyy")}`,
        generatedBy: profile?.name || "—",
      });
    } catch { toast.error("Could not generate the daily report"); }
  };

  return (
    <div className="space-y-5">
        {/* Title and toolbar on one line. Six outline buttons in a row all shouted at
            the same volume; what a supervisor does on this screen is log an action,
            so that one is the only filled button and everything else files under the
            two menus beside it. */}
        <PageHeader
          className="mb-0"
          module="Production"
          title="Quality"
          description="Log quality actions, track them to completion, and score them by severity."
          icon={<ShieldCheck className="h-5 w-5" />}
          actions={
            <>
              <div className="inline-flex rounded-md border bg-muted/40 p-0.5">
                <button type="button" onClick={() => setView("list")} className={cn("inline-flex items-center gap-1.5 rounded-[5px] px-3 py-1.5 text-xs font-semibold transition-colors", view === "list" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                  <List className="h-3.5 w-3.5" /> List
                </button>
                <button type="button" onClick={() => setView("analytics")} className={cn("inline-flex items-center gap-1.5 rounded-[5px] px-3 py-1.5 text-xs font-semibold transition-colors", view === "analytics" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                  <BarChart3 className="h-3.5 w-3.5" /> Analytics
                </button>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm"><Download className="h-4 w-4 mr-1.5" />Reports</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem onClick={printDaily}>
                    <Printer className="h-4 w-4 mr-2" />Print today's actions
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Selected period
                  </DropdownMenuLabel>
                  <DropdownMenuItem onClick={printPDF}>Print report (PDF)</DropdownMenuItem>
                  <DropdownMenuItem onClick={fullExcel}>Excel report (.xlsx)</DropdownMenuItem>
                  <DropdownMenuItem onClick={exportCSV}>Raw data (.csv)</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {canManage && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="px-2" aria-label="More quality settings">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setImportOpen(true)}>
                      <Upload className="h-4 w-4 mr-2" />Import actions
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setListsOpen(true)}>
                      <Tags className="h-4 w-4 mr-2" />Lists &amp; scoring
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setEditingId(null); setForm(makeEmptyForm()); } }}>
              <DialogTrigger asChild>
                <Button size="sm" onClick={() => { setEditingId(null); setForm(makeEmptyForm(domainFilter === "safety" ? "safety" : "quality")); }}>
                  <Plus className="h-4 w-4 mr-1.5" />
                  {domainFilter === "safety" ? "Log occurrence" : "Log action"}
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[90vh] overflow-y-auto">
                <DialogHeader><DialogTitle>{editingId ? "Edit action" : form.domain === "safety" ? "Log safety occurrence" : "Log quality action"}</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  {form.domain === "safety" ? (
                    /* The kind is the whole form.
                     *
                     * `scorecard_safety_counts` builds seven of the weekly scorecard's
                     * nine H&S fields out of this one value and nothing else, so it is
                     * the most consequential thing on screen — and it was a dropdown
                     * whose grouping only appeared once the menu was open. Laid out, it
                     * teaches the distinction it depends on: harm above signal above
                     * prevention, never a flat list of seven where First aid and Near
                     * miss read as neighbouring degrees.
                     *
                     * No Severity box any more. It charged nothing (a safety occurrence
                     * scores 0, always — see actionPoints()), it was graded by hand so
                     * no two people graded alike, and it sat beside the one field that
                     * does drive the scorecard looking equally important. What harm was
                     * done is now said by the kind, which is also the thing that counts.
                     *
                     * No Points box either, for the older half of the same reason.
                     */
                    <fieldset className="rounded-lg border border-border bg-muted/30 p-3">
                      <legend className="px-1 text-xs font-medium">
                        What happened<span className="text-destructive-strong" aria-label="required"> *</span>
                      </legend>
                      <div className="space-y-2.5">
                        {SAFETY_KIND_GROUPS.map((g) => (
                          <div key={g.group}>
                            <p className="text-2xs text-muted-foreground">
                              <span className="font-semibold uppercase tracking-wide">{g.title}</span>
                              <span> · {g.hint}</span>
                            </p>
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              {SAFETY_KINDS.filter((k) => k.group === g.group).map((k) => {
                                const on = form.safety_kind === k.value;
                                return (
                                  <button
                                    key={k.value}
                                    type="button"
                                    // A toggle, not a radio: picking the same kind twice
                                    // clears it, so a misclick is undone where it was
                                    // made rather than by hunting for a "— None —" row.
                                    aria-pressed={on}
                                    onClick={() => setForm({ ...form, safety_kind: on ? "" : k.value })}
                                    className={cn(
                                      "rounded-md border px-2.5 py-1.5 text-xs transition-colors",
                                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                                      on
                                        // The badge the same kind wears everywhere else on
                                        // this screen, so the choice and the row it becomes
                                        // are recognisably the same thing.
                                        ? cn(k.badge, "font-semibold shadow-sm")
                                        : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
                                    )}
                                  >
                                    {k.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </fieldset>
                  ) : (
                    /* No Severity and no Points box on a quality action any more.
                       `actionPoints()` charges the priced labels and falls back to the
                       grade only when none of them price it, so these two fields spent
                       most of their life naming a number the system did not use — and
                       whoever logged the action read that number as the score. The
                       labels below decide it, and the summary under them says so. */
                    null
                  )}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="min-w-0"><Label>Line{form.domain === "safety" && <span className="text-destructive-strong" aria-label="required"> *</span>}</Label>
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
                    <div><Label>Leader{form.domain === "safety" && <span className="text-destructive-strong" aria-label="required"> *</span>}</Label>
                      <Select
                        value={form.leader_id}
                        onValueChange={(v) => {
                          // Keep leader_name in step with leader_id — the create mutation
                          // and safetyFormBlockers both read leader_name, and a pick that
                          // only set the id would leave a safety row that looks unnamed.
                          const picked = leaders.find((l) => l.id === v);
                          setForm({ ...form, leader_id: v, leader_name: picked?.name ?? form.leader_name });
                        }}
                      >
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
                  {/* The grade, asked for again.
                      It was removed because `actionPoints()` let the labels REPLACE it,
                      which made the field name a number the system mostly did not use —
                      so the form derived it from the labels instead. Under MAX the grade
                      is half the comparison and can be the half that decides: an action
                      graded Critical carrying one cheap label is worth Critical. A
                      derived grade can never say that, because it is the label total
                      wearing a grade's name.
                      Quality only. A safety occurrence scores 0 whatever it is graded,
                      and classifies by `safety_kind` instead — see actionPoints(). */}
                  {form.domain !== "safety" && (
                    <div>
                      <Label>Severity</Label>
                      <Select
                        value={form.severity || "none"}
                        onValueChange={(v) => setForm({ ...form, severity: v === "none" ? "" : v })}
                      >
                        <SelectTrigger className="mt-1"><SelectValue placeholder="Not graded" /></SelectTrigger>
                        <SelectContent>
                          {/* Ungraded is a real answer and stays reachable. An action
                              priced only by its labels needs no grade, and forcing one
                              would put a severity on the card that nobody chose — the
                              failure `severityForPoints` returns null for. */}
                          <SelectItem value="none">Not graded</SelectItem>
                          {QUALITY_SEVERITIES.map((sv) => (
                            <SelectItem key={sv.value} value={sv.value}>
                              {sv.label} · {severityPoints(sv.value)}p
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div>
                    <Label>Labels</Label>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {/* Each domain gets its own vocabulary: the quality list names
                          none of the hazards a safety occurrence is about, which is
                          how safety got logged with no label at all. */}
                      {labelsForDomain(form.domain, LABEL_LISTS, form.labels).map((l) => {
                        const on = form.labels.includes(l);
                        // Priced labels say so on the chip: whoever is logging the action
                        // decides the score here, and should not find that out afterwards.
                        // Never on a safety occurrence — it scores 0 either way, so a
                        // price on the chip would name a number nothing charges.
                        const price = form.domain === "safety" ? 0 : labelPoints(l);
                        return (
                          <button key={l} type="button" onClick={() => toggleLabel(l)}
                            className={cn("rounded-full border px-2.5 py-1 text-xs transition-colors", on ? "border-primary bg-primary text-primary-foreground" : "bg-muted/40 hover:bg-accent")}>
                            {l}
                            {price > 0 && <span className={cn("ml-1 tabular-nums", on ? "opacity-80" : "text-muted-foreground")}>{price}p</span>}
                          </button>
                        );
                      })}
                    </div>
                    {/* What this action will be charged, said before Save and not after.
                        Rendered unconditionally on purpose: the zero case is the one
                        that matters. Most labels in this factory are still priced at 0,
                        so "no priced label" is a common and legitimate answer — it is
                        the SILENT zero that cost leaders deviations they had logged in
                        good faith. aria-live because the sentence changes under the
                        reader's hands as they tick chips. */}
                    {form.domain !== "safety" && (() => {
                      // The department is passed because the freeze trigger reads it:
                      // without it this sentence promised a grade that
                      // `action_points_at` was about to overwrite with 0.
                      // The domain picks which price list the chips are read against:
                      // a hazard prices a safety occurrence, a quality label does not.
                      const charge = logFormCharge(form.labels, excluded, undefined, form.department, undefined, form.domain);
                      const note = excludedLabelNote(form.labels, excluded);
                      // The grade is passed in now. Without it this sentence would go on
                      // telling somebody their Critical action scores 0 because they have
                      // not ticked a priced label.
                      const summary = chargeSummary(charge, form.severity || null);
                      return (
                        <div
                          role="status"
                          aria-live="polite"
                          className={cn(
                            "mt-2 rounded-md border px-2.5 py-1.5 text-xs",
                            charge.pricedByLabels || form.severity ? "bg-muted/40" : "border-dashed text-muted-foreground",
                          )}
                        >
                          <span className={cn((charge.pricedByLabels || form.severity) && "font-medium")}>{summary}</span>
                          {note && <span className="mt-0.5 block text-muted-foreground">{note}</span>}
                        </div>
                      );
                    })()}
                  </div>
                  <div><Label>Notes</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
                </div>
                {(() => {
                  // Unlike a number drawn early, a grade written early persists: an
                  // empty exclusion set is a valid answer meaning "nothing is
                  // excluded", so saving before the table loads files the unfiltered
                  // grade forever. Same guard the score block uses, different stakes.
                  const blockers = [
                    ...safetyFormBlockers(form),
                    ...(attributionReady || form.domain === "safety" ? [] : ["attribution still loading"]),
                  ];
                  return (
                    <DialogFooter className="flex-col items-end gap-1.5 sm:flex-col">
                      <Button onClick={() => create.mutate()} disabled={create.isPending || blockers.length > 0}>Save</Button>
                      {blockers.length > 0 && (
                        <p className="text-xs text-destructive-strong">Missing: {blockers.join(", ")}</p>
                      )}
                    </DialogFooter>
                  );
                })()}
              </DialogContent>
            </Dialog>
            </>
          }
        />

        {/* Quality and Safety share one log and one table, but never one number — see
            actionPoints(). The tab picks which domain everything below is about; All
            is for the rare moment both need to be seen side by side. */}
        <Tabs value={domainFilter} onValueChange={(v) => setDomainFilter(v as ActionDomainFilter)}>
          <TabsList>
            <TabsTrigger value="quality">Quality</TabsTrigger>
            <TabsTrigger value="safety">Safety</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Filters, above the figures they govern.
            They used to sit under the leader table, which put every number on this
            screen — the KPIs, the tracking, the recurring issues — above the control
            that decides what is counted. Read top to bottom it now says: this period
            and this line, then here is what it came to. */}
        {/* A grid, not a wrapping flex row.
            Seven controls at six different fixed widths (w-32 … w-44) wrapped into
            ragged rows and regularly orphaned the last one on a line of its own — the
            shape a control panel must not have, because a filter nobody notices is a
            number nobody can explain. Equal columns reflow 7 → 4 → 3 → 2 predictably
            and every control keeps the same target size at every width. */}
        <div className="rounded-lg border bg-muted/30 p-2">
          <div className="mb-2 flex items-center justify-between gap-2 pl-1">
            <span className="flex shrink-0 items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Filters
            </span>
            {activeFilters > 0 && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="h-7 text-xs text-muted-foreground hover:text-foreground">
                <X className="mr-1 h-3.5 w-3.5" />
                Clear {activeFilters} filter{activeFilters === 1 ? "" : "s"}
              </Button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
            {/* Period first, and spanning two columns at the narrow widths: it carries a
                date range rather than one word, and squeezing it to a half column is
                where "22/05/2026 – 19/08/2026" becomes an ellipsis. */}
            <div className="col-span-2 sm:col-span-1">
              <DateRangeFilter value={drRange} preset={drPreset} onChange={(r, p) => { setDrRange(r); setDrPreset(p); }} storageKey={OPS_RANGE_KEY} />
            </div>
            <Select value={filterSeverity} onValueChange={setFilterSeverity}>
              <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="__all__">All severity</SelectItem>{QUALITY_SEVERITIES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={filterValidation} onValueChange={setFilterValidation}>
              <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All validations</SelectItem>
                <SelectItem value="__pending__">Waiting on Quality</SelectItem>
                {VALIDATION_STATES.map((v) => <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterLine} onValueChange={setFilterLine}>
              <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="__all__">All Lines</SelectItem>{lineOptions.map((l) => <SelectItem key={l.name} value={l.name}>{l.name}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={filterDept} onValueChange={setFilterDept}>
              <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="__all__">All departments</SelectItem>{DEPTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={filterLeader} onValueChange={setFilterLeader}>
              <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="__all__">All leaders</SelectItem>{leaders.map((l) => <SelectItem key={l.id} value={l.name}>{l.name}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={filterShift} onValueChange={setFilterShift}>
              <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="__all__">All Shifts</SelectItem><SelectItem value="DAY">Day</SelectItem><SelectItem value="NIGHT">Night</SelectItem></SelectContent>
            </Select>
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
            // Safety never has a points figure to report — see actionPoints(). "0
            // points in range" would read as a claim ("this was worth nothing");
            // no sublabel at all is the honest version of that same fact.
            sublabel={domainFilter === "safety" ? undefined : (attributionReady ? `${kpis.totalPoints} points in range` : "Working out which actions count…")}
          />
          <KpiCard
            label="Waiting on Quality"
            icon={<Clock className="h-3.5 w-3.5" />}
            value={kpis.awaitingVerdict} accent="warning" toneValue
            sublabel="No verdict yet — no score moves"
            active={filterValidation === "__pending__"}
            onClick={() => setFilterValidation(filterValidation === "__pending__" ? "__all__" : "__pending__")}
          />
          {/* Not rendered on the Safety tab at all: a safety row is never worth a
              number of points, and "Open points: 0" is a claim next to a table whose
              Points column reads "—" for the exact same rows — see actionPoints(). */}
          {domainFilter !== "safety" && (
          <KpiCard
            label="Open points"
            icon={<Scale className="h-3.5 w-3.5" />}
            value={kpis.openPoints} accent="purple"
            loading={!attributionReady}
            sublabel="Weight still outstanding"
          />
          )}
          {/* Two different questions wearing one slot.
              Quality grades an action and asks how many severe ones stand. Safety no
              longer grades anything — the severity box came off that form — and asks
              the question an audit asks first: how many people were hurt. Counted off
              `safety_kind`, which is also what the weekly scorecard counts, so this
              card and that scorecard can never report different weeks. */}
          {domainFilter === "safety" ? (
          <KpiCard
            label="Harm reported"
            icon={<AlertTriangle className="h-3.5 w-3.5" />}
            value={kpis.harm} accent="danger"
            toneValue
            sublabel={
              kpis.unclassified
                // Louder than the breakdown, because it is the one that invalidates it.
                ? `${kpis.unclassified} occurrence${kpis.unclassified === 1 ? "" : "s"} not classified — counted nowhere`
                : kpis.harmBreakdown.map((b) => `${b.n} ${safetyKindMeta(b.kind)?.label.toLowerCase()}`).join(" · ")
            }
          />
          ) : (
          <KpiCard
            label="High / Critical open"
            icon={<AlertTriangle className="h-3.5 w-3.5" />}
            value={kpis.openSevere} accent="danger"
            toneValue
            sublabel={kpis.ungraded ? `${kpis.ungraded} action${kpis.ungraded === 1 ? "" : "s"} with no severity` : "Every action graded"}
            active={filterSeverity === "high" || filterSeverity === "critical"}
            onClick={() => setFilterSeverity(filterSeverity === "critical" ? "__all__" : "critical")}
          />
          )}
        </div>

        {/* The two readings of the same period, side by side on a wide screen: who
            carries the weight, and what keeps coming back. Stacked, the tracking table
            ran a metre wide for six figures and pushed the pattern below the fold.

            Neither card renders on the Safety tab at all. With every safety row
            priced at 0, both cards' tie-breaks fall to a raw count — whoever reported
            the most near misses would sort first under "Quality tracking by leader",
            and the same problem repeated the most under "Top recurring issues". There
            is no ordering of either that is not that inversion, so the fix is not to
            draw them here — this is the ONE purpose the safety domain exists for: a
            report can never cost, or rank, the person who filed it. */}
        {domainFilter !== "safety" && (
        <div className={cn("grid items-start gap-4", recurring.length > 0 && "xl:grid-cols-3")}>
          <div className={cn(recurring.length > 0 && "xl:col-span-2")}>
            <QualityTrackingByLeader actions={qualityOnly} periodLabel={periodLabel} />
          </div>
          {recurring.length > 0 && <TopRecurringIssues rows={recurring} />}
        </div>
        )}

        {view === "analytics" ? (
          <SectionErrorBoundary title="Quality analytics">
            <QualityAnalytics actions={filtered} from={from} domainFilter={domainFilter} />
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
                      {/* Read-only in both domains now. A quality action's grade is
                          derived from its labels (see buildQualityActionPayload), and
                          safety stopped having one at all — leaving either picker live
                          would let someone set a severity that charges nothing and that
                          the next save silently overwrites, which is the same
                          two-sources-of-truth this module keeps having to close. */}
                      {sev ? (
                        <Badge variant="outline" className={cn("text-2xs", sev.badge)} title={GRADE_FROM_LABELS}>{sev.label} · {sev.points}p</Badge>
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
                  {/* Validation and Severity came off this table.
                      Both are on the row's Issue dialog, one click away, and neither
                      was doing work here: the grade is derived from the labels and the
                      Points column already says what the action cost, while the verdict
                      is a decision Quality makes in the dialog rather than something
                      scanned across a page of 49 rows. */}
                  <TableHead>When</TableHead><TableHead>#</TableHead>
                  {/* A safety row is never worth a number of points — see actionPoints().
                      The Safety tab shows Kind instead of a Points column that would only
                      ever read 0; the All tab keeps both, with Points reading "—" on
                      safety rows so a zero can never be mistaken for "worth nothing". */}
                  {showPointsColumn && <TableHead className="text-right">Points</TableHead>}
                  {showKindColumn && <TableHead>Kind</TableHead>}
                  <TableHead>Line</TableHead><TableHead>Leader</TableHead>
                  <TableHead>Dept</TableHead><TableHead>Labels</TableHead><TableHead>Notes</TableHead>
                  {canManage && <TableHead className="w-10 text-right">Delete</TableHead>}
                </TableRow></TableHeader>
                <TableBody>
                  {filtered.length === 0 && <TableRow><TableCell colSpan={logColSpan} className="text-center text-muted-foreground">No actions</TableCell></TableRow>}
                  {filtered.map((a) => {
                    const sev = severityMeta(a.severity);
                    const isSafetyRow = domainOf(a) === "safety";
                    const kind = safetyKindMeta(a.safety_kind);
                    return (
                    <TableRow key={a.id} className="cursor-pointer" onClick={() => setDetailId(a.id)}>
                      <TableCell className="whitespace-nowrap">{format(new Date(a.recorded_at), "dd/MM HH:mm")}</TableCell>
                      <TableCell className="font-figure text-xs">{a.action_no ?? "—"}</TableCell>
                      {/* What this action actually costs, not what its severity is worth.
                          The two differ once a label is priced, and the column that adds
                          up to the totals above must be the one people read.
                          A safety row reads "—" here, never 0: 0 says "this was worth
                          nothing", and safety is never worth anything either way — see
                          actionPoints(). This picks which column draws the row, it does
                          not re-decide what the row is worth. */}
                      {showPointsColumn && (
                        <TableCell className="text-right tabular-nums font-semibold">
                          {isSafetyRow ? (
                            <span className="font-normal text-muted-foreground">—</span>
                          ) : (() => {
                            const charged = actionPoints(a, excluded);
                            const bySeverity = severityPoints(a.severity);
                            if (!sev && !charged) return <span className="font-normal text-muted-foreground">—</span>;
                            // The same sentence the detail dialog prints, from the same
                            // function. Two hand-written explanations of one number is
                            // how the log and the dialog end up contradicting each other.
                            return (
                              <span title={pointsBreakdown(a, excluded).explanation}>
                                {charged}
                                {charged !== bySeverity && <span className="ml-0.5 font-normal text-muted-foreground">*</span>}
                              </span>
                            );
                          })()}
                        </TableCell>
                      )}
                      {showKindColumn && (
                        <TableCell>
                          {kind ? (
                            <Badge variant="outline" className={cn("text-2xs", kind.badge)}>{kind.label}</Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      )}
                      <TableCell>{a.line ?? "—"}</TableCell>
                      <TableCell>{a.leader_name ?? "—"}</TableCell>
                      <TableCell>{a.department ?? "—"}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {/* Coloured by which list the label came from — quality,
                              maintenance or hazard — because three lists now share one
                              log and a flat grey chip made them read as one vocabulary.
                              A label no list claims keeps the neutral badge. */}
                          {(a.labels ?? []).map((l) => (
                            <Badge key={l} variant="outline" className={cn("text-2xs", labelBadge(labelKindOf(l, LABEL_KINDS)))}>{l}</Badge>
                          ))}
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
          onOpenChange={(o) => { if (!o) closeDetail(); }}
          onDelete={() => { if (detailAction) { deleteAction.mutate(detailAction.id); closeDetail(); } }}
          onEdit={() => { if (detailAction) openEdit(detailAction); }}
        />

        {canManage && (
          <Dialog open={listsOpen} onOpenChange={setListsOpen}>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
              {/* Scoped to the tab it was opened from.
                  Opened from Safety, this dialog showed the severity weights, the three
                  pillar weights of the leader score and the quality label prices —
                  every one of which is arithmetic a safety occurrence is deliberately
                  exempt from (see actionPoints()). Offering someone a scoring editor on
                  the one domain that is never scored invites them to set a number and
                  then wonder why nothing moved. */}
              <DialogHeader>
                <DialogTitle>{domainFilter === "safety" ? "Health & Safety lists" : "Lists & scoring"}</DialogTitle>
              </DialogHeader>
              {domainFilter !== "safety" && <SeverityPointsEditor />}
              {domainFilter !== "safety" && <LeaderScoreWeightsEditor />}
              <QualityListsManager domain={domainFilter === "safety" ? "safety" : "quality"} />
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


// `IssueCard` was removed here. It was the Kanban card — draggable, with an `onMove`
// that set To do / In progress / Complete — and nothing has rendered it since the board
// came off this page. It was the last thing in `src/` that could still write `status`,
// which is exactly the sort of leftover that gets wired back up by someone who assumes
// a component this finished must be in use.

// ============================================================
// Issue detail — photos + audit history
// ============================================================
function DetailMeta({ label, value }: { label: string; value: string | null | undefined }) {
  return <div><span className="text-muted-foreground">{label}: </span>{value || "—"}</div>;
}

function describeHistory(h: QualityHistoryRow): string {
  if (h.field === "created") return "Issue created";
  // Kept, alone, deliberately. Nothing writes `status` any more, but entries recorded
  // while it did are in the history of real actions, and a history that cannot read
  // its own past entries is worse than the field it is trying to forget.
  if (h.field === "status") return `Status: ${statusMeta(h.old_value).label} → ${statusMeta(h.new_value).label}`;
  if (h.field === "severity") return `Severity: ${severityMeta(h.old_value)?.label ?? "None"} → ${severityMeta(h.new_value)?.label ?? "None"}`;
  return `${h.field}: ${h.old_value ?? "—"} → ${h.new_value ?? "—"}`;
}

// `PhotoThumb` was removed here, with the Photos block it rendered. Attachments are
// captured in SafetyCulture now; the `attachments` column and every path already in it
// are untouched, so nothing that was uploaded is lost — this page simply stops being a
// second place to look for it.

function QualityIssueDetail({ action, canManage, onOpenChange, onDelete, onEdit }: {
  action: QualityAction | null; canManage: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: () => void; onEdit: () => void;
}) {
  const { data: history = [] } = useQualityHistory(action?.id);
  // Same colours as the table behind it. Read through the hook rather than threaded
  // down as a prop: the detail dialog is opened from three places and one of them
  // would have been given the wrong map eventually.
  const labelKinds = useLabelKinds();
  // Read here rather than threaded down: the score block is the one part of this
  // dialog that must not draw before attribution has loaded, and a prop passed from
  // a parent that does not need it would be one more place to forget the guard.
  const { excluded, ready: attributionReady, failed: attributionFailed } = useLeaderAttribution();
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
              {/* The charge leads. It is the figure this action is remembered by, and
                  the dialog used to be the one place that would not say it. */}
              <ActionScore
                action={action}
                excluded={excluded}
                ready={attributionReady}
                failed={attributionFailed}
              />
              <div className="grid grid-cols-2 gap-3">
                <div><Label>{action.domain === "safety" ? "Kind" : "Severity"}</Label>
                  {action.domain === "safety" ? (
                    /* A safety occurrence is classified, not graded. The severity
                       picker that stood here charged nothing and was set by hand; the
                       kind is what `scorecard_safety_counts` reads, so it is the fact
                       worth showing. Changed on Edit action, with the rest of the row,
                       rather than nudged from a detail view — the weekly H&S counts
                       move when it changes. */
                    <div className="mt-1 flex items-center gap-2">
                      {safetyKindMeta(action.safety_kind)
                        ? <Badge variant="outline" className={cn("text-xs", safetyKindMeta(action.safety_kind)!.badge)}>{safetyKindMeta(action.safety_kind)!.label}</Badge>
                        : <span className="text-sm text-muted-foreground">—</span>}
                      <span className="text-2xs text-muted-foreground">Counted in the weekly H&amp;S scorecard</span>
                    </div>
                  ) : (
                    /* Read-only for quality: the grade comes from the labels below and
                       is re-derived whenever the action is saved, so a pick made here
                       would not survive the next edit. */
                    <div className="mt-1 flex items-center gap-2">
                      {severityMeta(action.severity)
                        ? <Badge variant="outline" className={cn("text-xs", severityMeta(action.severity)!.badge)}>{severityMeta(action.severity)!.label}</Badge>
                        : <span className="text-sm text-muted-foreground">—</span>}
                      <span className="text-2xs text-muted-foreground">{GRADE_FROM_LABELS}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* The Validation block was removed here: the verdict picker (Open / Under
                  investigation / Validated / Rejected), the hint under it, and the
                  closure box with Approve closure and Reopen.

                  It is not hidden, it is gone, and the consequence belongs next to the
                  hole rather than in a commit message. `rejected` was the only way to
                  say a deviation was not the leader's — a machine fault, a supplier
                  defect — and no screen can say it any more, so every logged action
                  charges its leader in full. Closure needed a verdict first, so no
                  action can be closed either, and the "Awaiting verdict" filter now
                  matches every open row by construction.

                  `validation_status`, `validated_at`, `validated_by` and `closed_at`
                  keep every value they already hold; the leader scorecard, the filters,
                  the table badge and the export all still read them. What has gone is
                  the only writer. */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                {/* Shown only for a safety row — a quality action never carries a
                    Kind, and Severity above already says what a quality row is. */}
                {domainOf(action) === "safety" && (
                  <DetailMeta label="Kind" value={safetyKindMeta(action.safety_kind)?.label} />
                )}
                <DetailMeta label="Line" value={action.line} />
                <DetailMeta label="Shift" value={action.shift} />
                <DetailMeta label="Leader" value={action.leader_name} />
                <DetailMeta label="Department" value={action.department} />
                <DetailMeta label="Logged" value={format(new Date(action.recorded_at), "dd/MM/yyyy HH:mm")} />
              </div>

              {(action.labels?.length ?? 0) > 0 && (
                <div className="flex flex-wrap gap-1">{(action.labels ?? []).map((l) => (
                  <Badge key={l} variant="outline" className={cn("text-2xs", labelBadge(labelKindOf(l, labelKinds)))}>{l}</Badge>
                ))}</div>
              )}
              {action.description && <p className="whitespace-pre-wrap rounded border bg-muted/30 p-2 text-sm">{action.description}</p>}

              {/* The Photos block was removed here, with the upload, the thumbnails and
                  the evidence gate on validation above. Evidence for a deviation lives
                  in SafetyCulture, which is where it is captured on the floor; a second
                  place to put it is a second place to look for it, and the one that is
                  half-populated is the one that gets believed.

                  The gate had to go with it, and it lives in the database rather than
                  here: `enforce_quality_validation` refused a validation while
                  `attachments` was empty, so removing the upload without removing the
                  trigger would leave the only verdict path one the database always
                  rejects. That is dropped in
                  20260827090000_the_evidence_gate_outlived_the_place_to_attach_it.sql —
                  a migration this repository does not apply, so it is only true of
                  production once it has been run there.

                  Existing rows keep their `attachments`; nothing is deleted. */}
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
 * What changing a weight DOES depends on the database, so the screen asks rather than
 * asserts — see `useScoringFreeze`. With 20260822090000 applied, a save opens a new
 * dated scoring version and every action already logged keeps the points in force on
 * its own date. Without it, points are still derived on every render and a change
 * genuinely re-scores the whole history.
 *
 * Both sentences are true somewhere, and the wrong one is worse than none: this is the
 * screen where somebody is about to change a number, and they will change it based on
 * what this paragraph told them it would do.
 */
function SeverityPointsEditor() {
  const { data: rows, isLoading } = useSeverityPointRows();
  const save = useUpdateSeverityPoints();
  const { frozen } = useScoringFreeze();
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
          Used for column totals, the leader scorecard and Analytics.{" "}
          {frozen
            ? "Changing a weight opens a new scoring version — actions already logged keep the points that were in force on the date they were recorded."
            : "Changing a weight re-scores past actions too — the score always follows the severity on the card."}
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

/**
 * The price on one label, saved when the box loses focus or on Enter.
 *
 * A draft rather than a live value: typing "12" over a "5" passes through "1", and
 * saving that would price the label at 1 for as long as it took to type the second
 * digit. The freeze does not make this safe — it makes it worse in a way that lasts:
 * every action logged during that keystroke would be frozen at the wrong price, and a
 * frozen figure is the one thing a later correction to the label does not reach.
 * No Save button, because one number is not a form — the toast confirms it landed.
 */
function PointsBox({ value, label, onCommit }: { value: number; label: string; onCommit: (raw: string) => void }) {
  const [draft, setDraft] = useState(String(value));
  return (
    <Input
      type="number" min={0} max={1000} inputMode="numeric"
      className={cn("h-8 w-16 tabular-nums", !value && "text-muted-foreground")}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
      aria-label={`Points charged by ${label}`}
      title={value ? `An action labelled "${label}" costs ${value}` : "Unpriced — the action keeps its severity weight"}
    />
  );
}

/** The same ceiling the database enforces, so the box cannot promise what it refuses. */
const clampPoints = (raw: string) => Math.max(0, Math.min(1000, Math.round(Number(raw) || 0)));

/**
 * @param domain  which tab this was opened from. On `safety` the manager shows the
 *   H&S hazard list and nothing else: the quality label prices, the severity weights
 *   and the leader-score weights are all arithmetic a safety occurrence never touches.
 */
function QualityListsManager({ domain = "quality" }: { domain?: "quality" | "safety" }) {
  const isSafety = domain === "safety";
  const qc = useQueryClient();
  const { data: options = [] } = useAllQualityOptions();
  // Which labels are the leader's to answer for is scoring, not taxonomy, so it
  // belongs on the screen that prices them. It lived only in a migration until now:
  // Maintenance and GMP shipped excluded and no screen showed it, so nobody could
  // see whether the rule was in force — and when the table is absent it silently
  // is not. That is the "Maintenance is charging the leader 3 points" case.
  const { excluded, missing: attributionMissing } = useLeaderAttribution();
  const { missing: gatesMissing } = useGateLabels();
  // The department half of attribution, added with 20260827093000. `missing` matters
  // for the same reason it does for the labels: without the column NOTHING is excluded,
  // every department charges, and a row of switches that save nothing is worse than a
  // warning saying so.
  const { missing: deptAttributionMissing } = useDepartmentAttribution();
  const setAttribution = useSetLabelAttribution();
  const [kind, setKind] = useState<QualityOption["kind"]>(isSafety ? "safety_label" : "label");
  const [value, setValue] = useState("");
  const [points, setPoints] = useState("");

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["quality_options_all"] });
    qc.invalidateQueries({ queryKey: ["quality_options"] });
  };

  /**
   * The points column arrives in a migration, and a migration in this repo is not
   * proof that production has it. Saying so beats showing "column does not exist" to
   * a quality manager who only wanted to price a label.
   *
   * A write is refused by PostgREST rather than by Postgres, so it carries a different
   * code from a read — which is why this branch never fired on 17/08 and the manager
   * read "Could not find the 'points' column … in the schema cache" instead. Both
   * codes live in `isMissingColumn` now.
   */
  const reportSaveError = (error: { code?: string; message: string }) => {
    if (isMissingColumn(error)) {
      toast.error("Label points are not enabled on this database yet — the migration has not run.");
      return;
    }
    toast.error(error.message);
  };

  const add = async () => {
    const v = value.trim();
    if (!v) return;
    const maxSort = options.filter((o) => o.kind === kind).reduce((m, o) => Math.max(m, o.sort), 0);
    const p = kind === "department" ? 0 : clampPoints(points);
    const row = { kind, value: v, sort: maxSort + 1, active: true, ...(p ? { points: p } : {}) };
    const { error } = await supabase
      .from("quality_options")
      .insert(row as unknown as never);
    if (error) { reportSaveError(error); return; }
    setValue(""); setPoints(""); refresh();
  };

  /**
   * Marking a label as a gate, or unmarking it.
   *
   * Deliberately NOT a points field with a magic value. A gate is not an amount — it is
   * a ceiling, and the whole reason it exists is that no number of points could express
   * "this period is Red whatever else happened". Giving it a number would invite
   * somebody to weigh it against one.
   *
   * Invalidates the action queries because every leader's score can move on this: a
   * period holding a newly-gated label is capped from the moment this saves. It does
   * NOT re-score the past through points — the cap is computed at read time from the
   * label list, which is why a gate reaches history and a price no longer does.
   */
  const setLabelGate = async (o: QualityOption, next: boolean) => {
    const { error } = await supabase
       
      .from("quality_options")
      .update({ is_gate: next } as unknown as never)
      .eq("id", o.id);
    if (error) { reportSaveError(error); return; }
    qc.invalidateQueries({ queryKey: ["quality_actions"] });
    refresh();
    toast.success(next ? `${o.value} now gates the period` : `${o.value} no longer gates`);
  };

  /**
   * Re-pricing a label. What that reaches depends on the database.
   *
   * Frozen (20260822090000 applied): it opens a new scoring version and applies from
   * here on. Actions already logged keep what they were worth. Not frozen: it re-scores
   * every action carrying the label, past ones included.
   *
   * The invalidation below is right either way — under the freeze the boards still have
   * to redraw, because an action logged TODAY was frozen against the version this save
   * just replaced.
   */
  const setLabelPrice = async (o: QualityOption, raw: string) => {
    const n = clampPoints(raw);
    if (n === o.points) return;
    const { error } = await supabase
      .from("quality_options")
      .update({ points: n } as unknown as never)
      .eq("id", o.id);
    if (error) { reportSaveError(error); return; }
    // The board, the log, the scorecard and Analytics all read a score off this.
    qc.invalidateQueries({ queryKey: ["quality_actions"] });
    qc.invalidateQueries({ queryKey: ["analytics-quality"] });
    refresh();
    toast.success(n ? `"${o.value}" now costs ${n} point${n === 1 ? "" : "s"}` : `"${o.value}" no longer prices an action`);
  };
  const toggle = async (o: QualityOption) => {
    const { error } = await supabase
      .from("quality_options")
      .update({ active: !o.active } as unknown as never)
      .eq("id", o.id);
    if (error) { toast.error(error.message); return; }
    refresh();
  };
  const remove = async (o: QualityOption) => {
    const { error } = await supabase
      .from("quality_options")
      .delete()
      .eq("id", o.id);
    if (error) { toast.error(error.message); return; }
    refresh();
  };

  /**
   * Moving a department on or off the leader's bill.
   *
   * The same shape as `setLabelGate` — a boolean on `quality_options` — and reaching
   * exactly as far as a re-price does under the freeze: 20260827093000 opens a new
   * scoring version on this write, so actions already logged keep the figure they were
   * frozen with and everything from here on is scored under the new answer.
   *
   * Nobody's July total moves because of a decision taken in August. That is worth
   * knowing before clicking, so the toast says which way it went rather than "Saved".
   */
  const setDepartmentCharge = async (o: QualityOption, next: boolean) => {
    const { error } = await supabase
       
      .from("quality_options")
      .update({ counts_against_leader: next } as unknown as never)
      .eq("id", o.id);
    if (error) { reportSaveError(error); return; }
    qc.invalidateQueries({ queryKey: ["quality_actions"] });
    qc.invalidateQueries({ queryKey: ["analytics-quality"] });
    refresh();
    toast.success(
      next
        ? `Actions in ${o.value} are charged to the leader`
        : `Actions in ${o.value} are charged to nobody`,
    );
  };

  const groups = listGroups(domain);

  /**
   * A column the list does not have, said out loud.
   *
   * The whole reason this screen was reported as broken: a Health & Safety row drew
   * nothing under Points, and an empty cell under a live column header reads as a
   * control that failed to load. A dash reads as an answer. The title carries the
   * reason for anyone who wants it.
   */
  const NotApplicable = ({ why }: { why: string }) => (
    <span className="text-center text-sm text-muted-foreground/50" title={why} aria-label={why}>
      —
    </span>
  );

  /** Item · Points · Gate · Charged to · Shown. One grid, so every list lines up. */
  const GRID = "grid min-w-[40rem] grid-cols-[minmax(9rem,1fr)_4.5rem_7rem_8rem_7.5rem] items-center gap-2";

  return (
    <div className="space-y-5">
      <div className="flex gap-2">
        {/* One kind to add here, so the picker would be a control with a single
            answer. Named in the placeholder below instead. */}
        {!isSafety && (
        <Select value={kind} onValueChange={(v) => setKind(v as QualityOption["kind"])}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="label">Quality action</SelectItem>
            <SelectItem value="maintenance_label">Maintenance</SelectItem>
            <SelectItem value="safety_label">Health &amp; Safety</SelectItem>
            <SelectItem value="department">Department</SelectItem>
          </SelectContent>
        </Select>
        )}
        <Input placeholder={isSafety ? "New hazard..." : "New value..."} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        {/* Every label list carries a price now; only departments never do. What the
            price DOES differs by list and is stated on each list's own header — see
            qualityListGroups.ts. */}
        {kind !== "department" && (
          <Input
            type="number" min={0} max={1000} inputMode="numeric"
            className="w-20 tabular-nums" placeholder="pts"
            value={points} onChange={(e) => setPoints(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
            aria-label="Points this label charges"
          />
        )}
        <Button onClick={add}>Add</Button>
      </div>

      {/* The three ways this screen can be lying about what is in force. Each one is a
          migration that has not run, and each leaves a control that saves nothing or a
          rule that is quietly off. Said before the lists, because they change how every
          row below should be read. */}
      {gatesMissing && !isSafety && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-xs text-warning-strong">
          Food safety gates are not enabled on this database yet — the migration has not run. Nothing below
          can be marked as a gate, and no period is being capped for a failed CCP or a foreign body.
        </p>
      )}
      {attributionMissing && !isSafety && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-xs text-warning-strong">
          Label attribution is not enabled on this database yet — the migration has not run. Every quality
          action is currently charging the leader, including the ones marked below as charged to nobody.
        </p>
      )}
      {deptAttributionMissing && !isSafety && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-xs text-warning-strong">
          Department attribution is not enabled on this database yet — the migration has not run. Every
          department is currently charging the leader, Maintenance included.
        </p>
      )}

      {groups.map((g) => {
        const rows = options.filter((o) => o.kind === g.kind);
        const priced = rows.filter((o) => o.points > 0).length;
        return (
          <section key={g.kind} className={cn("overflow-hidden rounded-lg border bg-card", railEdge(g.rail))}>
            <header className="border-b bg-muted/40 px-3 py-2">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-sm font-semibold tracking-tight">{g.title}</h3>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {rows.length} {rows.length === 1 ? "item" : "items"}
                  {g.columns.points && ` · ${priced} priced`}
                </span>
              </div>
              {/* The sentence that was missing on this tab. See qualityListGroups.ts. */}
              <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">{g.effect}</p>
            </header>

            <div className="overflow-x-auto">
              {/* Column headers are the fix, not decoration. Under a live header a dash
                  says "this list is not priced"; with no header at all the same empty
                  space said "the points box is broken". */}
              <div className={cn(GRID, "border-b px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground")}>
                <span>Item</span>
                <span className="text-center">Points</span>
                <span className="text-center">Gate</span>
                <span className="text-center">Charged to</span>
                <span className="text-right">Shown</span>
              </div>

              {rows.length === 0 && (
                // An empty list here does NOT mean an empty picker: both label lists fall
                // back to the built-in one, and saying "None yet" while the log form shows
                // eight chips is how a manager ends up adding all eight again.
                <p className="px-3 py-2.5 text-sm text-muted-foreground">
                  {g.kind === "safety_label"
                    ? `None saved — the log uses the built-in list: ${SAFETY_LABELS.join(", ")}.`
                    : "None yet. Add the first one above."}
                </p>
              )}

              {rows.map((o) => {
                const isExcludedLabel = excluded.has(o.value.trim().toLowerCase());
                return (
                  <div key={o.id} className={cn(GRID, "border-b px-3 py-1.5 last:border-b-0 hover:bg-muted/30")}>
                    <span className={cn("truncate text-sm", !o.active && "text-muted-foreground line-through")} title={o.value}>
                      {o.value}
                    </span>

                    {g.columns.points ? (
                      <PointsBox
                        key={`${o.id}:${o.points}`}
                        value={o.points}
                        label={o.value}
                        onCommit={(raw) => setLabelPrice(o, raw)}
                      />
                    ) : (
                      <NotApplicable why={`${g.title} carry no points.`} />
                    )}

                    {g.columns.gate ? (
                      /* A gate is a different kind of thing from a price and reads as
                         one: no number, and the on state is the destructive colour,
                         because switching it on is a statement about the whole period
                         and not an adjustment to a total. */
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={gatesMissing}
                        className={cn(
                          "h-8 w-full whitespace-nowrap text-xs",
                          o.is_gate && "border-destructive/40 bg-destructive/10 text-destructive-strong",
                        )}
                        title={
                          gatesMissing
                            ? "Not available until the food safety gate migration has run."
                            : o.is_gate
                              ? `An action labelled ${o.value} forces the period to Red and limits the score to ${GATE_CAP}%. Click to stop it gating.`
                              : `Make ${o.value} a gate: any action carrying it caps the period at ${GATE_CAP}%, whatever else happened.`
                        }
                        onClick={() => setLabelGate(o, !o.is_gate)}
                      >
                        {o.is_gate ? "Gate" : "Not a gate"}
                      </Button>
                    ) : (
                      <NotApplicable why={`${g.title} cannot cap a period.`} />
                    )}

                    {g.columns.attribution && g.kind === "label" && (
                      /* Two states, both spelled out, because the difference is money
                         on somebody's scorecard. Re-attributing reaches exactly as far
                         as re-pricing does — the whole history without the freeze, and
                         only from here on with it, because 20260822090000 versions the
                         exclusion set alongside the prices. See useSetLabelAttribution. */
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={attributionMissing || setAttribution.isPending}
                        className={cn(
                          "h-8 w-full whitespace-nowrap text-xs",
                          isExcludedLabel && "border-warning/40 bg-warning/10 text-warning-strong",
                        )}
                        title={
                          isExcludedLabel
                            ? `An action labelled "${o.value}" costs the leader nothing. Click to charge it to them.`
                            : `An action labelled "${o.value}" is charged to the leader. Click to stop charging it.`
                        }
                        onClick={() => {
                          const counts = isExcludedLabel;
                          setAttribution.mutate(
                            { label: o.value, counts },
                            {
                              onError: (e: unknown) => toast.error((e as { message?: string })?.message ?? "Could not save"),
                              onSuccess: () => toast.success(
                                counts
                                  ? `Actions labelled "${o.value}" are charged to the leader`
                                  : `Actions labelled "${o.value}" are charged to nobody`,
                              ),
                            },
                          );
                        }}
                      >
                        {isExcludedLabel ? "Nobody" : "Leader"}
                      </Button>
                    )}

                    {g.columns.attribution && g.kind === "department" && (
                      /* The department half of the same decision, added with
                         20260827093000. A veto rather than a vote — see
                         countsAgainstLeaderDepartment for why one field may do that
                         and a label may not. */
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={deptAttributionMissing}
                        className={cn(
                          "h-8 w-full whitespace-nowrap text-xs",
                          !o.counts_against_leader && "border-warning/40 bg-warning/10 text-warning-strong",
                        )}
                        title={
                          deptAttributionMissing
                            ? "Not available until the department attribution migration has run."
                            : o.counts_against_leader
                              ? `Actions booked to ${o.value} are charged to the leader. Click to stop charging them.`
                              : `Actions booked to ${o.value} cost no leader a point. Click to charge them to the leader.`
                        }
                        onClick={() => setDepartmentCharge(o, !o.counts_against_leader)}
                      >
                        {o.counts_against_leader ? "Leader" : "Nobody"}
                      </Button>
                    )}

                    {!g.columns.attribution && (
                      <NotApplicable why={`${g.title} are never charged to anybody.`} />
                    )}

                    <div className="flex items-center justify-end gap-1">
                      <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => toggle(o)}>
                        {o.active ? "Hide" : "Show"}
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive-strong" aria-label={`Remove ${o.value}`}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
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
                );
              })}
            </div>
          </section>
        );
      })}
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
 * Points, not just a count: ten Low actions and one Critical are not the same
 * problem, and the count alone said they were. Priced by `issueWeight`, which reads
 * the label's own price first and falls back to severity — so this table cannot say
 * a foreign body is worth 4 while the log beside it says 5.
 *
 * Deliberately NOT `actionPoints`: this ranks problems, not people. Attribution
 * answers "whose score is this", and filtering maintenance out here would hide the
 * recurring machine faults that most need fixing. Rejected actions stay in for the
 * same reason — Quality rejecting one instance does not make the pattern go away.
 */
interface RecurringIssue { text: string; count: number; points: number; lines: Set<string> }

/** The same complaint raised more than once in the period, heaviest first. */
function recurringIssues(actions: QualityAction[]): RecurringIssue[] {
  const m = new Map<string, RecurringIssue>();
  for (const a of actions) {
    const text = (a.description ?? "").trim();
    if (!text) continue;
    const key = text.toLowerCase().slice(0, 80);
    const e = m.get(key) ?? { text, count: 0, points: 0, lines: new Set<string>() };
    e.count += 1;
    e.points += issueWeight([a]);
    if (a.line) e.lines.add(a.line);
    m.set(key, e);
  }
  return Array.from(m.values())
    .filter((r) => r.count >= 2)
    .sort((a, b) => b.count - a.count || b.points - a.points)
    .slice(0, 5);
}

function TopRecurringIssues({ rows }: { rows: RecurringIssue[] }) {
  if (rows.length === 0) return null;

  return (
    <Card className="break-inside-avoid">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wide">
          <Repeat className="h-4 w-4 text-muted-foreground" />
          Top recurring issues
        </CardTitle>
        <CardDescription className="text-2xs leading-snug">
          Raised more than once in this period. One occurrence is an incident, not a pattern.
        </CardDescription>
      </CardHeader>
      {/* A list with hairlines, not five bordered boxes: the boxes drew five frames
          around text that was already a list, and none of them meant anything. */}
      <CardContent className="divide-y divide-border/60 pt-0">
        {rows.map((r) => (
          <div key={r.text} className="flex items-start gap-3 py-2.5 text-xs first:pt-0">
            <span className="min-w-0 flex-1">
              {/* Two lines, not one: an issue clipped at "did not match the p…" is
                  a row you have to click to read, and this card exists to be scanned. */}
              <span className="block line-clamp-2 font-medium leading-snug text-foreground">{r.text}</span>
              <span className="block truncate text-2xs text-muted-foreground">
                {r.lines.size ? Array.from(r.lines).join(", ") : "No line recorded"}
              </span>
            </span>
            <span className="shrink-0 whitespace-nowrap text-right">
              <span className="block font-figure text-sm font-bold tabular-nums text-foreground">{r.count}×</span>
              <span className="block font-figure text-2xs text-muted-foreground">{r.points} pts</span>
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ============================================================
// Analytics
// ============================================================
function QualityAnalytics({ actions, from, domainFilter }: { actions: QualityAction[]; from: string; domainFilter: ActionDomainFilter }) {
  const { excluded, ready: attributionReady, failed: attributionFailed } = useLeaderAttribution();
  // `byDay` was removed here, with the "Actions by status over time" chart it fed.
  //
  // It stacked To do / In progress / Complete, which is the state of a working board —
  // and this is not where that work happens: an open action is tracked in
  // SafetyCulture, and the module exists to control actions by line leader and to feed
  // the leader's performance scorecard. The chart also flattered the record. Its `s`
  // fell back to "todo" for any unrecognised status, so rows carrying nothing were
  // drawn as a real backlog, and it counted rows Quality had already rejected as if
  // they stood. What replaces it is the card that was always underneath: who is
  // carrying the weight.

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
  // The same roll-up the leader table uses, out in qualityBreakdown so a test can
  // hold the two side by side. This bar chart used to charge every action, including
  // the ones Quality had rejected. Safety rows are dropped before this ranks anyone:
  // with every safety row priced at 0, the chart's tie-break falls to raw count, and
  // "most near misses reported" would sort first — the ranking is not drawn at all
  // on the Safety tab, see below.
  const leaderboardActions = useMemo(() => actions.filter((a) => domainOf(a) !== "safety"), [actions]);
  const byLeader = useMemo(() => leaderPointsBreakdown(leaderboardActions, excluded), [leaderboardActions, excluded]);
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
      {/* Leaderboard — who has the most actions. Not drawn at all on the Safety tab:
          every safety row prices at 0, so the ranking's tie-break is a raw count and
          "most near misses reported" would sort to the top — the one inversion this
          domain exists to prevent. No ordering of this card is a correct one there. */}
      {domainFilter !== "safety" && (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <CardTitle className="text-base">Actions by leader <span className="text-xs font-normal text-muted-foreground">· ranked by points</span></CardTitle>
          <Input value={leaderSearch} onChange={(e) => setLeaderSearch(e.target.value)} placeholder="Search leader…" className="h-8 w-48" />
        </CardHeader>
        <CardContent>
          {/* Bars AND their order come from points, so this waits rather than drawing
              a ranking it is about to rearrange in front of the reader. */}
          {!attributionReady ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {attributionFailed
                ? "Points are unavailable: the label attribution table could not be read."
                : "Working out which actions count…"}
            </p>
          ) : filteredLeaders.length === 0 ? (
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
      )}

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

