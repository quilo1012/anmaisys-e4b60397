import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronLeft, ChevronRight, Download, RefreshCw, Target, AlertOctagon, BarChart3, Printer, CalendarIcon, Eye, EyeOff, ChevronDown, ChevronUp } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { format, startOfWeek, addDays, addWeeks, getISOWeek, startOfMonth, endOfMonth, isSameMonth } from "date-fns";
import { Link } from "react-router-dom";
import { ManageLinesDialog } from "@/components/ManageLinesDialog";
import { EmptyState } from "@/components/EmptyState";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FileText, FileSpreadsheet } from "lucide-react";
import { exportRagPdf, exportRagExcel } from "@/lib/ragExports";
import { useAuth } from "@/contexts/AuthContext";


import { Settings2 } from "lucide-react";
import { downloadRagTemplate } from "@/lib/ragTemplateExport";
import { useRole } from "@/hooks/useRole";
import { useIsFetching } from "@tanstack/react-query";
import { SyncStatusIndicator } from "@/components/SyncStatusIndicator";
import { reconcileMinutes } from "@/lib/downtimeReconcile";
import { mapWoToStop } from "@/lib/ragDowntime";
import { bucketFromReason } from "@/lib/downtimeBuckets";

/** Display-only label mapping for line names. Keeps DB identity untouched. */
function displayLineLabel(name: string): string {
  const s = (name ?? "").trim();
  const m = s.match(/^Line\s*0*(\d+)$/i);
  if (m) return `Filler Line ${m[1]}`;
  if (/^gel machine$/i.test(s) || /^gel line$/i.test(s)) return "GEL Machine";
  if (/^capsules?\s*&\s*tablets?$/i.test(s) || /^tablet line$/i.test(s)) return "Capsules & Tablets";
  return s;
}

/** Compute UTC ms for a London-local time on a given date. */
function londonUtcMs(dateStr: string, hour: number): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d, hour);
  const local = new Date(utc).toLocaleString("en-GB", {
    timeZone: "Europe/London", hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
  const mm = local.match(/(\d{2})\/(\d{2})\/(\d{4}),\s*(\d{2}):(\d{2})/);
  const localHour = mm ? Number(mm[4]) : hour;
  return utc + (hour - localHour) * 3600_000;
}
function londonShiftWindow(dateStr: string, shift: "DAY" | "NIGHT"): [number, number] {
  if (shift === "DAY") return [londonUtcMs(dateStr, 6), londonUtcMs(dateStr, 18)];
  const [y, m, d] = dateStr.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const nextStr = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
  return [londonUtcMs(dateStr, 18), londonUtcMs(nextStr, 6)];
}

type Shift = "DAY" | "NIGHT";

interface Entry {
  id: string;
  entry_date: string;
  line: string;
  shift: Shift;
  plan_qty: number;
  actual_qty: number;
  upm_target: number;
  upm_actual: number;
  downtime_min: number;
  notes: string | null;
}

interface StopDetail {
  line: string;
  start: string;
  end: string | null;
  source: "WO" | "Manual" | "Prod";
  ref: string | null;
  machine: string | null;
  reason: string | null;
  status?: string | null;
  kind: string; // bucket label, e.g. "MAINT", "Cleaning", "Break", "Changeover", "Quality"
  category?: string | null;
}

interface ClampedStop extends StopDetail {
  clampedStart: string;
  clampedEnd: string;
  minutes: number;
  ongoing: boolean;
}

// Map a free-text category to a downtime bucket label.
// Rules:
//   - 'WO Request'                                          → WO Request (internal, opened by operator)
//   - 'Maintenance' / 'Maint Downtime (iTouching)' / 'Maint'→ MAINT (iTouching)
//   - 'Break'                                               → Break
//   - 'Brushing Cleaning' / 'Deep Clean' / etc              → Cleaning
//   - 'Changeover'                                          → Changeover
//   - 'Quality'                                             → Quality
//   - any other non-empty value                             → passed through verbatim
//   - empty / unknown                                       → MAINT (safe default)
export function categoryBucket(cat?: string | null): string {
  const raw = (cat ?? "").toString().trim();
  if (!raw) return "MAINT";
  const lc = raw.toLowerCase();
  if (
    lc === "wo request" ||
    lc === "wo_request" ||
    lc === "wo-request"
  ) return "WO Request";
  if (
    lc === "maintenance" ||
    lc === "maint" ||
    lc.includes("itouching")
  ) return "MAINT";
  return raw;
}




const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function ragColor(actual: number, plan: number): string {
  if (!plan) return "";
  // Strict: green only when meeting/exceeding the plan (delta >= 0).
  if (actual >= plan) return "bg-success/20 text-success font-medium";
  const pct = (actual / plan) * 100;
  if (pct >= 90) return "bg-warning/20 text-warning font-medium";
  return "bg-destructive/20 text-destructive font-medium";
}

export default function RAGWeeklyPage() {
  const qc = useQueryClient();
  const { is: isRole, can } = useRole();
  const { user, profile } = useAuth();
  const isAdmin = isRole("admin");
  const isManager = isRole("manager");
  const canComment = isAdmin || isManager;
  // Single source of truth: the permission matrix (includes supervisor).
  const canEditRagEntries = can("rag.manage");
  const [weekStart, setWeekStart] = useState<Date>(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 })
  );
  const [editing, setEditing] = useState<{
    date: string; line: string; shift: Shift; entry?: Entry;
  } | null>(null);
  const [manageLinesOpen, setManageLinesOpen] = useState(false);
  

  const weekDates = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );
  const weekStartStr = format(weekStart, "yyyy-MM-dd");
  const weekEndStr = format(addDays(weekStart, 6), "yyyy-MM-dd");

  const { data: lines = [] } = useQuery({
    queryKey: ["rag-lines"],
    queryFn: async () => {
      const { data, error } = await supabase.from("lines").select("name,active").order("name");
      if (error) throw error;
      const EXCLUDED = ["sealer", "printer ink"];
      return (data ?? [])
        .filter((r: { active?: boolean | null }) => r.active !== false)
        .map((r: { name: string }) => r.name)
        .filter((n) => !EXCLUDED.includes(n.trim().toLowerCase()))
        .sort((a, b) => {
          const rank = (n: string): [number, number] => {
            const s = n.toLowerCase();
            const m = s.match(/line\s*0*(\d+)/);
            if (m) return [0, Number(m[1])];
            if (s.includes("capsule") || s.includes("tablet")) return [1, 0];
            if (s.includes("gel")) return [2, 0];
            return [3, 0];
          };
          const [ra, na] = rank(a);
          const [rb, nb] = rank(b);
          return ra !== rb ? ra - rb : na !== nb ? na - nb : a.localeCompare(b);
        });
    },
  });

  const { data: entries = [] } = useQuery({
    queryKey: ["rag-week", weekStartStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rag_weekly_entries")
        .select("*")
        .gte("entry_date", weekStartStr)
        .lte("entry_date", weekEndStr);
      if (error) throw error;
      return (data ?? []) as Entry[];
    },
  });

  const entryMap = useMemo(() => {
    const map = new Map<string, Entry>();
    for (const e of entries) map.set(`${e.entry_date}|${e.line}|${e.shift}`, e);
    return map;
  }, [entries]);

  // Realtime: when production_items actual/plan change, the trigger updates
  // rag_weekly_entries. Subscribe to both so line totals update live.
  useEffect(() => {
    const ch = supabase
      .channel(`rag-live-${weekStartStr}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "rag_weekly_entries" }, () => {
        qc.invalidateQueries({ queryKey: ["rag-week", weekStartStr] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "production_items" }, () => {
        qc.invalidateQueries({ queryKey: ["rag-week", weekStartStr] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [weekStartStr, qc]);


  // Auto downtime per (date|line|shift) from work orders + manual downtime.
  const padStartIso = new Date(weekStart.getTime() - 24 * 3600_000).toISOString();
  const padEndIso = addDays(weekStart, 8).toISOString();
  const { data: lineStops = [], error: lineStopsError } = useQuery({
    queryKey: ["rag-week-line-stops", weekStartStr],
    queryFn: async () => {
      // Downtime source: WO Request only. iTouching production_downtimes were
      // pulling in "No Planned Shift" and other stop codes that artificially
      // inflated downtime — excluded here so RAG reflects operator-reported stops.
      const [woRes, manRes] = await Promise.all([
        supabase.from("work_orders")
          .select("wo_number, status, machine, description, line_at_time, line_stopped_at, line_resumed_at, created_at, finished_at, closed_at, operator_id, intouch_stop_code, engineer_id")
          .not("line_stopped_at", "is", null)
          .gte("line_stopped_at", padStartIso)
          .lte("line_stopped_at", padEndIso),
        (supabase as any).from("downtime")
          .select("line, machine, reason, category, started_at, ended_at")
          .gte("started_at", padStartIso).lte("started_at", padEndIso),
      ]);
      if (woRes.error) throw woRes.error;
      if ((manRes as any).error) throw (manRes as any).error;

      const wo: StopDetail[] = ((woRes.data ?? []) as any[]).map((r) => {
        const mapped = mapWoToStop(r);
        return {
          line: mapped?.line ?? (r.line_at_time as string | null),
          start: (mapped?.start ?? r.line_stopped_at) as string,
          end: (mapped?.end ?? null) as string | null,
          source: "WO" as const,
          ref: r.wo_number as string | null,
          machine: r.machine as string | null,
          reason: r.description as string | null,
          status: r.status as string | null,
          kind: "WO Request",
          category: "WO Request",
        };
      });


      // Map reason -> bucket. Rows returning `null` (e.g. "No Planned Shift")
      // are excluded from all downtime calculations.
      const mapRow = (r: any, source: "Manual" | "Prod"): StopDetail | null => {
        const bucket = bucketFromReason(r.reason, r.category);
        if (bucket === null) return null;
        return {
          line: r.line as string | null,
          start: r.started_at as string,
          end: r.ended_at as string | null,
          source,
          ref: null,
          machine: r.machine as string | null,
          reason: r.reason as string | null,
          kind: bucket,
          category: r.category ?? null,
        };
      };

      const man = ((manRes.data ?? []) as any[])
        .map((r) => mapRow(r, "Manual"))
        .filter((s): s is StopDetail => s !== null);

      return [...wo, ...man].filter((s) => s.line && s.start) as StopDetail[];

    },
  });

  // Items by week — drives scrap impact in popover + rounding mismatch detection.
  const weekStartIso = weekStartStr;
  const weekEndIso = format(addDays(weekStart, 6), "yyyy-MM-dd");
  const { data: weekItems = [] } = useQuery({
    queryKey: ["rag-week-items", weekStartStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_sessions")
        .select("session_date, line, shift, production_items(planned_qty, target_qty, scrap_qty)")
        .gte("session_date", weekStartIso)
        .lte("session_date", weekEndIso);
      if (error) throw error;
      return (data ?? []) as Array<{
        session_date: string; line: string; shift: "DAY" | "NIGHT";
        production_items?: { planned_qty: number | null; target_qty: number | null; scrap_qty: number | null }[];
      }>;
    },
  });

  const { cellScrapMap, cellItemTargetMap } = useMemo(() => {
    const scrap = new Map<string, number>();
    const tgt = new Map<string, number>();
    for (const s of weekItems) {
      const k = `${s.session_date}|${s.line}|${s.shift}`;
      const items = s.production_items ?? [];
      scrap.set(k, items.reduce((a, i) => a + Number(i.scrap_qty ?? 0), 0));
      tgt.set(k, items.reduce((a, i) => a + Number(i.target_qty ?? i.planned_qty ?? 0), 0));
    }
    return { cellScrapMap: scrap, cellItemTargetMap: tgt };
  }, [weekItems]);




  const { autoDtMap, autoDtBucketMap, autoDtBreakdown } = useMemo(() => {
    const byLine = new Map<string, StopDetail[]>();
    for (const s of lineStops) {
      const arr = byLine.get(s.line) ?? [];
      arr.push(s);
      byLine.set(s.line, arr);
    }
    const out = new Map<string, number>();
    // bucket -> (cellKey -> minutes)
    const buckets = new Map<string, Map<string, number>>();
    const breakdown = new Map<string, ClampedStop[]>();
    const now = Date.now();
    for (const line of lines) {
      const stops = byLine.get(line) ?? [];
      if (!stops.length) continue;
      // Group stops by bucket once per line.
      const byBucket = new Map<string, StopDetail[]>();
      for (const s of stops) {
        const b = s.kind || "MAINT";
        const arr = byBucket.get(b) ?? [];
        arr.push(s);
        byBucket.set(b, arr);
      }
      for (const d of weekDates) {
        const ds = format(d, "yyyy-MM-dd");
        for (const shift of ["DAY", "NIGHT"] as Shift[]) {
          const [ws, we] = londonShiftWindow(ds, shift);
          const k = `${ds}|${line}|${shift}`;
          let cellTotal = 0;
          for (const [bucket, bStops] of byBucket.entries()) {
            const m = reconcileMinutes(bStops, ws, we);
            if (m > 0) {
              const map = buckets.get(bucket) ?? new Map<string, number>();
              map.set(k, m);
              buckets.set(bucket, map);
              cellTotal += m;
            }
          }
          if (cellTotal > 0) out.set(k, cellTotal);
          const clamped: ClampedStop[] = [];
          for (const s of stops) {
            const sMs = new Date(s.start).getTime();
            const eMs = s.end ? new Date(s.end).getTime() : now;
            const cs = Math.max(sMs, ws);
            const ce = Math.min(eMs, we);
            if (ce > cs) {
              clamped.push({
                ...s,
                clampedStart: new Date(cs).toISOString(),
                clampedEnd: new Date(ce).toISOString(),
                minutes: Math.round((ce - cs) / 60_000),
                ongoing: !s.end,
              });
            }
          }
          if (clamped.length) {
            clamped.sort((a, b) => a.clampedStart.localeCompare(b.clampedStart));
            breakdown.set(k, clamped);
          }
        }
      }
    }
    return { autoDtMap: out, autoDtBucketMap: buckets, autoDtBreakdown: breakdown };
  }, [lineStops, lines, weekDates]);

  // Inconsistency detector: a single WO contributing minutes to multiple (date|line|shift) cells
  // is legitimate when a stop overlaps the 06:00/18:00 boundary, but is flagged so reviewers
  // can confirm there's no double-allocation bug.
  const inconsistencies = useMemo(() => {
    const byRef = new Map<string, { ref: string; line: string; cells: { key: string; minutes: number }[]; total: number }>();
    for (const [key, items] of autoDtBreakdown.entries()) {
      for (const it of items) {
        if (!it.ref || it.source !== "WO") continue;
        const id = `${it.ref}`;
        const cur = byRef.get(id) ?? { ref: id, line: it.line ?? "", cells: [], total: 0 };
        cur.cells.push({ key, minutes: it.minutes });
        cur.total += it.minutes;
        byRef.set(id, cur);
      }
    }
    return Array.from(byRef.values()).filter((r) => r.cells.length > 1);
  }, [autoDtBreakdown]);


  const upsertMutation = useMutation({
    mutationFn: async (payload: Omit<Entry, "id">) => {
      const { error } = await supabase
        .from("rag_weekly_entries")
        .upsert(payload, { onConflict: "entry_date,line,shift" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rag-week", weekStartStr] });
      toast.success("Saved");
      setEditing(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Bump EVERY target (plan_qty) for the visible week by 1% in one click — compounds
  // ×1.01, rounded, at least +1, so you don't have to click each cell's +1%.
  const bumpAllMutation = useMutation({
    mutationFn: async () => {
      const targets = entries.filter((e) => Number(e.plan_qty) > 0);
      if (targets.length === 0) throw new Error("No targets to increase this week");
      const rows = targets.map((e) => {
        const cur = Number(e.plan_qty) || 0;
        return {
          entry_date: e.entry_date, line: e.line, shift: e.shift,
          plan_qty: Math.max(cur + 1, Math.round(cur * 1.01)),
          actual_qty: e.actual_qty,
          upm_target: e.upm_target, upm_actual: e.upm_actual,
          downtime_min: e.downtime_min, notes: e.notes ?? null,
        };
      });
      const { error } = await supabase
        .from("rag_weekly_entries")
        .upsert(rows, { onConflict: "entry_date,line,shift" });
      if (error) throw error;
      return rows.length;
    },
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: ["rag-week", weekStartStr] });
      toast.success(`+1% applied to ${n} target${n === 1 ? "" : "s"}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const exportXlsx = async () => {
    const XLSX = await import("xlsx");
    const headers = ["Date", "Line", "Shift", "Plan", "Actual", "Variance %", "UPM Target", "UPM Actual", "Downtime (min)", "Notes"];
    const rows = entries.map((e) => [
      e.entry_date, e.line, e.shift, e.plan_qty, e.actual_qty,
      e.plan_qty ? Number((((e.actual_qty - e.plan_qty) / e.plan_qty) * 100).toFixed(1)) : "",
      e.upm_target, e.upm_actual, e.downtime_min, e.notes ?? "",
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Week ${getISOWeek(weekStart)}`);
    XLSX.writeFile(wb, `rag-week-${weekStartStr}.xlsx`);
  };

  const exportLayoutTemplate = async () => {
    const XLSX = await import("xlsx");
    const dates = Array.from({ length: 7 }, (_, i) => format(addDays(weekStart, i), "dd/MM/yyyy"));
    const aoa: (string | number)[][] = [];
    aoa.push([`RAG Weekly Template · Week ${getISOWeek(weekStart)} · ${format(weekStart, "dd MMM yyyy")}`]);
    aoa.push([]);
    const dayNightHeader = ["", ...dates.flatMap((d) => [d, ""])];
    const subHeader = ["", ...dates.flatMap(() => ["Day", "Night"])];
    for (const line of lines) {
      aoa.push([line]);
      aoa.push(dayNightHeader);
      aoa.push(subHeader);
      aoa.push(["Plan", ...dates.flatMap(() => ["", ""])]);
      aoa.push(["Actual", ...dates.flatMap(() => ["", ""])]);
      aoa.push(["Downtime", ...dates.flatMap(() => ["", ""])]);
      aoa.push([]);
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 18 }, ...Array(14).fill({ wch: 10 })];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "RAG Template");
    XLSX.writeFile(wb, `rag-template-${weekStartStr}.xlsx`);
  };


  // RAG block-layout importer (lines as blocks; Plan/Actual/Downtime rows × Mon-Sun × Day/Night/Total)
  const importLayoutMutation = useMutation({
    mutationFn: async (file: File) => {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });

      const inWeek = (d: string) => d >= weekStartStr && d <= weekEndStr;
      const toDate = (v: unknown): string | null => {
        if (v === null || v === undefined || v === "") return null;
        if (v instanceof Date && !isNaN(v.getTime())) {
          const s = format(v, "yyyy-MM-dd");
          return inWeek(s) ? s : null;
        }
        const s = String(v).trim();
        // strict dd/mm/yyyy or dd-mm-yyyy (year >= 2020)
        const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
        if (m) {
          const [, d, mo, y] = m;
          const yyyy = y.length === 2 ? `20${y}` : y;
          if (Number(yyyy) < 2020) return null;
          const out = `${yyyy}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
          return inWeek(out) ? out : null;
        }
        // Excel serial number
        const n = Number(s);
        if (!isNaN(n) && n > 40000 && n < 80000) {
          const out = format(new Date(Math.round((n - 25569) * 86400 * 1000)), "yyyy-MM-dd");
          return inWeek(out) ? out : null;
        }
        return null;
      };
      const num = (v: unknown) => {
        const raw = String(v ?? "").trim();
        const n = Number(raw.replace(/[, ]/g, ""));
        return isNaN(n) ? 0 : n;
      };
      const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();
      const clean = (v: unknown) => norm(v).replace(/[^a-z0-9]+/g, " ").trim();
      const knownLines = lines;
      const selectedWeekDates = weekDates.map((d) => format(d, "yyyy-MM-dd"));

      const agg = new Map<string, { plan: number; actual: number; downtime: number }>();
      const bump = (date: string, line: string, shift: Shift, patch: Partial<{ plan: number; actual: number; downtime: number }>) => {
        const k = `${date}|${line}|${shift}`;
        const ex = agg.get(k) ?? { plan: 0, actual: 0, downtime: 0 };
        // Replace with the largest non-zero value seen (avoids double-counting
        // when the sheet repeats Plan/Actual/Downtime in summary/total rows).
        agg.set(k, {
          plan: Math.max(ex.plan, patch.plan ?? 0),
          actual: Math.max(ex.actual, patch.actual ?? 0),
          downtime: Math.max(ex.downtime, patch.downtime ?? 0),
        });
      };


      let debugSample: unknown[][] = [];
      let blocksFound = 0;
      let metricRowsFound = 0;

      for (const sheetName of wb.SheetNames) {
        const ws = wb.Sheets[sheetName];
        const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: false });
        if (!debugSample.length) debugSample = aoa.slice(0, 20) as unknown[][];

        let currentLine: string | null = null;
        let currentDates: string[] = [];
        let currentCols: number[] = [];
        let currentDayNightCols: { day: number; night: number }[] = [];

        const hasMetricNear = (startRow: number) => {
          for (let rr = startRow + 1; rr <= Math.min(aoa.length - 1, startRow + 8); rr++) {
            const label = clean((aoa[rr] ?? []).slice(0, 8).join(" "));
            if (/\b(plan|planned|target|actual|produced|downtime|down time|dt)\b/.test(label)) return true;
          }
          return false;
        };

        const aliasMap: Record<string, string> = {
          "tablet": "Capsules & Tablets",
          "tablets": "Capsules & Tablets",
          "tablet line": "Capsules & Tablets",
          "tablets line": "Capsules & Tablets",
          "capsule": "Capsules & Tablets",
          "capsules": "Capsules & Tablets",
          "capsule line": "Capsules & Tablets",
          "capsules line": "Capsules & Tablets",
          "caps tabs": "Capsules & Tablets",
          "c t": "Capsules & Tablets",
          "gel": "Gel Line",
          "gel line": "Gel Line",
        };
        const findLineMatch = (text: string): string | null => {
          const t = clean(text);
          if (!t) return null;
          if (aliasMap[t] && knownLines.includes(aliasMap[t])) return aliasMap[t];
          // exact
          for (const l of knownLines) if (clean(l) === t) return l;
          // substring (either direction)
          for (const l of knownLines) {
            const ll = clean(l);
            if (ll.length >= 3 && (t.includes(ll) || ll.includes(t))) return l;
          }
          // token-overlap fallback (handles "Capsules & Tablets" vs "capsules and tablets",
          // "Caps & Tabs", "C & T", "Gel", etc.)
          const stop = new Set(["line", "linha", "ln", "and", "the", "of", "de", "da", "do"]);
          const tTokens = new Set(t.split(" ").filter((w) => w.length >= 3 && !stop.has(w)));
          const tAbbrev = t.replace(/\s+/g, "");
          for (const l of knownLines) {
            const ll = clean(l);
            const lTokens = ll.split(" ").filter((w) => w.length >= 3 && !stop.has(w));
            if (lTokens.length === 0) continue;
            const hits = lTokens.filter((w) => tTokens.has(w)).length;
            if (hits >= Math.min(1, lTokens.length) && (hits / lTokens.length) >= 0.5) return l;
            // abbreviation match: "c t" / "ct" against "capsules tablets"
            const initials = lTokens.map((w) => w[0]).join("");
            if (initials.length >= 2 && (tAbbrev === initials || t.split(" ").join("") === initials)) return l;
          }
          // fallback when database line labels differ from Excel labels (ex: "Line 1 - Filler")
          const lineToken = t.match(/\b(?:line|linha|ln|l)\s*0*(\d{1,2})\b/);
          if (lineToken) {
            const n = Number(lineToken[1]);
            const dbMatch = knownLines.find((l) => new RegExp(`\\b0*${n}\\b`).test(clean(l)));
            return dbMatch ?? `Line ${n}`;
          }
          return null;
        };

        const updateHeaderFromRows = (rowIndex: number) => {
          const candidates: { col: number; date: string }[] = [];
          for (let rr = Math.max(0, rowIndex - 3); rr <= Math.min(aoa.length - 1, rowIndex + 3); rr++) {
            const row = aoa[rr] ?? [];
            for (let c = 0; c < row.length; c++) {
              const d = toDate(row[c]);
              if (d) candidates.push({ col: c, date: d });
            }
          }
          if (candidates.length >= 5) {
            const seen = new Set<string>();
            const uniq: { col: number; date: string }[] = [];
            for (const d of candidates.sort((a, b) => a.col - b.col)) {
              if (!seen.has(d.date)) { seen.add(d.date); uniq.push(d); }
            }
            currentDates = uniq.slice(0, 7).map((u) => u.date);
            currentCols = uniq.slice(0, 7).map((u) => u.col);
            currentDayNightCols = currentCols.map((col) => ({ day: col, night: col + 1 }));
            return true;
          }

          for (let rr = Math.max(0, rowIndex - 3); rr <= Math.min(aoa.length - 1, rowIndex + 3); rr++) {
            const row = aoa[rr] ?? [];
            const dayCols = new Map<string, number>();
            for (let c = 0; c < row.length; c++) {
              const label = clean(row[c]);
              const weekday = label.match(/^(mon|monday|seg|segunda|tue|tuesday|ter|terca|terça|wed|wednesday|qua|quarta|thu|thursday|qui|quinta|fri|friday|sex|sexta|sat|saturday|sab|sábado|sun|sunday|dom|domingo)$/)?.[1];
              if (weekday && !dayCols.has(weekday.slice(0, 3))) dayCols.set(weekday.slice(0, 3), c);
            }
            const ordered = ["mon", "seg", "tue", "ter", "wed", "qua", "thu", "qui", "fri", "sex", "sat", "sab", "sun", "dom"]
              .map((d) => dayCols.get(d))
              .filter((c): c is number => typeof c === "number");
            const uniqueOrdered = [...new Set(ordered)];
            if (uniqueOrdered.length >= 5) {
              currentDates = selectedWeekDates;
              currentCols = uniqueOrdered.slice(0, 7);
              currentDayNightCols = currentCols.map((col) => ({ day: col, night: col + 1 }));
              return true;
            }
          }

          return false;
        };

        for (let r = 0; r < aoa.length; r++) {
          const row = aoa[r] ?? [];

          // line label detection across first 10 cells, partial match + line-number fallback
          for (let c = 0; c < Math.min(10, row.length); c++) {
            const cell = norm(row[c]);
            if (!cell || cell.length < 3) continue;
            const match = findLineMatch(cell);
            if (match && hasMetricNear(r)) {
              currentLine = match;
              currentDates = []; currentCols = []; currentDayNightCols = [];
              updateHeaderFromRows(r);
              blocksFound++;
              break;
            }
          }

          // date row detection
          const dc: { col: number; date: string }[] = [];
          for (let c = 1; c < row.length; c++) {
            const d = toDate(row[c]);
            if (d) dc.push({ col: c, date: d });
          }
          if (dc.length >= 5) {
            const seen = new Set<string>();
            const uniq: { col: number; date: string }[] = [];
            for (const d of dc) if (!seen.has(d.date)) { seen.add(d.date); uniq.push(d); }
            currentDates = uniq.slice(0, 7).map((u) => u.date);
            currentCols = uniq.slice(0, 7).map((u) => u.col);
            currentDayNightCols = currentCols.map((col) => ({ day: col, night: col + 1 }));
            continue;
          }

          if (currentLine && !currentDates.length) updateHeaderFromRows(r);
          if (!currentLine || !currentDates.length) continue;

          const label = clean(row.slice(0, 8).join(" "));
          // Skip summary/derived rows so they don't double-count
          if (/\b(total|variance|var|upm|percent|percentage)\b/.test(label) || label.includes("%")) continue;
          let metric: "plan" | "actual" | "downtime" | null = null;
          if (/\b(downtime|down time|dt|paragem|parada)\b/.test(label)) metric = "downtime";
          else if (/\b(actual|produced|production)\b/.test(label)) metric = "actual";
          else if (/\b(plan|planned|target)\b/.test(label)) metric = "plan";
          if (!metric) continue;

          metricRowsFound++;

          for (let i = 0; i < currentDates.length; i++) {
            const date = currentDates[i];
            const cols = currentDayNightCols[i] ?? { day: currentCols[i], night: currentCols[i] + 1 };
            const dayVal = num(row[cols.day]);
            const nightVal = num(row[cols.night]);
            const patchDay = metric === "plan" ? { plan: dayVal } : metric === "actual" ? { actual: dayVal } : { downtime: dayVal };
            const patchNight = metric === "plan" ? { plan: nightVal } : metric === "actual" ? { actual: nightVal } : { downtime: nightVal };
            bump(date, currentLine, "DAY", patchDay);
            bump(date, currentLine, "NIGHT", patchNight);
          }
        }
      }

      const payload: Omit<Entry, "id">[] = [];

      for (const [k, v] of agg) {
        if (!v.plan && !v.actual && !v.downtime) continue;
        const [entry_date, line, shift] = k.split("|");
        payload.push({
          entry_date, line, shift: shift as Shift,
          plan_qty: v.plan, actual_qty: v.actual,
          upm_target: 0, upm_actual: 0,
          downtime_min: v.downtime, notes: null,
        });
      }
      if (!payload.length) throw new Error("No RAG blocks detected. Check that line names match and dates are present.");

      const BATCH = 500;
      let count = 0;
      for (let i = 0; i < payload.length; i += BATCH) {
        const slice = payload.slice(i, i + BATCH);
        const { error } = await supabase
          .from("rag_weekly_entries")
          .upsert(slice, { onConflict: "entry_date,line,shift" });
        if (error) throw error;
        count += slice.length;
      }
      return count;
    },
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: ["rag-week", weekStartStr] });
      toast.success(`Imported ${n} RAG cells`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      // 1. Plan/Actual from production sessions
      const { data: sessions, error: sErr } = await supabase
        .from("production_sessions")
        .select("line, session_date, shift, production_items(planned_qty, actual_qty, target_qty)")
        .gte("session_date", weekStartStr)
        .lte("session_date", weekEndStr);
      if (sErr) throw sErr;

      // 2. Downtime from work_orders + events
      const { data: linesRows } = await supabase.from("lines").select("id, name");
      const lineMap = new Map((linesRows ?? []).map((l: { id: string; name: string }) => [l.id, l.name]));
      const { data: events, error: eErr } = await supabase
        .from("downtime_events")
        .select("stopped_at, duration_minutes, work_orders(line_id)")
        .gte("stopped_at", `${weekStartStr}T00:00:00Z`)
        .lte("stopped_at", `${weekEndStr}T23:59:59Z`)
        .not("resumed_at", "is", null);
      if (eErr) throw eErr;

      const agg = new Map<string, { plan: number; actual: number; downtime: number }>();
      const bump = (k: string, patch: Partial<{ plan: number; actual: number; downtime: number }>) => {
        const ex = agg.get(k) ?? { plan: 0, actual: 0, downtime: 0 };
        agg.set(k, {
          plan: ex.plan + (patch.plan ?? 0),
          actual: ex.actual + (patch.actual ?? 0),
          downtime: ex.downtime + (patch.downtime ?? 0),
        });
      };

      for (const s of sessions ?? []) {
        const items = (s as { production_items?: { planned_qty: number; actual_qty: number; target_qty: number | null }[] }).production_items ?? [];
        const plan = items.reduce((a, i) => a + Number(i.target_qty ?? i.planned_qty ?? 0), 0);
        const actual = items.reduce((a, i) => a + Number(i.actual_qty ?? 0), 0);
        bump(`${s.session_date}|${s.line}|${s.shift}`, { plan, actual });
      }

      for (const ev of events ?? []) {
        const wo = (ev as { work_orders?: { line_id: string | null } | null }).work_orders;
        const lineName = wo?.line_id ? lineMap.get(wo.line_id) : null;
        if (!lineName) continue;
        const dt = new Date(ev.stopped_at as string);
        const londonHour = (dt.getUTCHours() + 1) % 24; // BST
        const shift: Shift = londonHour >= 6 && londonHour < 18 ? "DAY" : "NIGHT";
        const dateStr = format(dt, "yyyy-MM-dd");
        bump(`${dateStr}|${lineName}|${shift}`, { downtime: Number(ev.duration_minutes ?? 0) });
      }

      const rows: Omit<Entry, "id">[] = [];
      for (const [key, v] of agg) {
        const [entry_date, line, shift] = key.split("|");
        const existing = entryMap.get(key);
        rows.push({
          entry_date,
          line,
          shift: shift as Shift,
          plan_qty: v.plan || existing?.plan_qty || 0,
          actual_qty: v.actual || existing?.actual_qty || 0,
          upm_target: existing?.upm_target ?? 0,
          upm_actual: existing?.upm_actual ?? 0,
          downtime_min: v.downtime || existing?.downtime_min || 0,
          notes: existing?.notes ?? null,
        });
      }
      if (!rows.length) return 0;
      const { error } = await supabase
        .from("rag_weekly_entries")
        .upsert(rows, { onConflict: "entry_date,line,shift" });
      if (error) throw error;
      return rows.length;
    },
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: ["rag-week", weekStartStr] });
      toast.success(`Synced ${n} cells from Planner & Downtime`);
    },
    onError: (e: Error) => toast.error(e.message),
  });



  const weekNumber = getISOWeek(weekStart);
  const monthAnchor = startOfMonth(weekStart);
  const monthWeeks = useMemo(() => {
    const first = startOfWeek(monthAnchor, { weekStartsOn: 1 });
    const last = endOfMonth(monthAnchor);
    const out: Date[] = [];
    let cur = first;
    while (cur <= last) { out.push(cur); cur = addWeeks(cur, 1); }
    return out;
  }, [monthAnchor]);

  const ragFetching = useIsFetching({ queryKey: ["rag-week", weekStartStr] });

  return (
    <DashboardLayout>
      <div className="p-3 md:p-6 space-y-4">
        <Card className="border-l-4 border-l-primary border-primary/20 shadow-md bg-gradient-to-br from-background to-muted/30">
          <CardHeader className="flex flex-col gap-3 p-3 md:p-6">
            <div className="flex flex-row items-center justify-between gap-2 flex-wrap">
              <CardTitle className="flex items-center gap-2 text-sm md:text-base">
                <Button size="icon" variant="outline" onClick={() => setWeekStart(addWeeks(weekStart, -1))}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="px-1 md:px-2">Wk {weekNumber} · {format(weekStart, "dd MMM")} – {format(addDays(weekStart, 6), "dd MMM yyyy")}</span>
                <Button size="icon" variant="outline" onClick={() => setWeekStart(addWeeks(weekStart, 1))}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </CardTitle>
              <div className="flex flex-wrap gap-2 w-full sm:w-auto items-center">
                <SyncStatusIndicator
                  isSyncing={
                    ragFetching > 0 ||
                    upsertMutation.isPending ||
                    importLayoutMutation.isPending ||
                    syncMutation.isPending
                  }
                  error={
                    upsertMutation.error ||
                    importLayoutMutation.error ||
                    syncMutation.error
                  }
                />

                <Button variant="outline" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>This week</Button>
                <Button variant="default" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending}>
                  <RefreshCw className={`h-4 w-4 mr-1 ${syncMutation.isPending ? "animate-spin" : ""}`} />
                  {syncMutation.isPending ? "Syncing..." : "Sync from system"}
                </Button>
                {canEditRagEntries && (
                  <Button
                    variant="outline"
                    onClick={() => bumpAllMutation.mutate()}
                    disabled={bumpAllMutation.isPending || entries.length === 0}
                    title="Increase every target this week by 1% at once"
                  >
                    <ChevronUp className={`h-4 w-4 mr-1 ${bumpAllMutation.isPending ? "animate-pulse" : ""}`} />
                    {bumpAllMutation.isPending ? "Applying…" : "+1% all targets"}
                  </Button>
                )}
                {isAdmin && (
                  <Button
                    onClick={() => downloadRagTemplate(weekStart, lines).catch((e) => toast.error(e.message))}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground"
                  >
                    <Download className="h-4 w-4 mr-1" />Download Template
                  </Button>
                )}
                {isAdmin && (
                  <Button variant="outline" onClick={() => setManageLinesOpen(true)}>
                    <Settings2 className="h-4 w-4 mr-1" />Manage Lines
                  </Button>
                )}
                <Select
                  onValueChange={(v) => {
                    const id = v === "__all__" ? "rag-line-all" : `rag-line-${v.replace(/\s+/g, "-")}`;
                    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                >
                  <SelectTrigger className="w-[170px]">
                    <SelectValue placeholder="Jump to line" />
                  </SelectTrigger>
                  <SelectContent className="bg-popover z-50">
                    {lines.map((l) => (
                      <SelectItem key={l} value={l}>{displayLineLabel(l)}</SelectItem>
                    ))}
                    <SelectItem value="__all__">All Lines</SelectItem>
                  </SelectContent>
                </Select>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline">
                      <Download className="h-4 w-4 mr-1" />Export
                      <ChevronDown className="h-4 w-4 ml-1" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="bg-popover z-50">
                    <DropdownMenuItem
                      onClick={async () => {
                        try {
                          const weekStartStrLocal = format(weekStart, "yyyy-MM-dd");
                          const { data: cRows } = await (supabase as any)
                            .from("rag_weekly_comments")
                            .select("line, comment")
                            .eq("week_start", weekStartStrLocal);
                          const cMap = new Map<string, string>();
                          for (const r of (cRows ?? []) as { line: string; comment: string }[]) cMap.set(r.line, r.comment ?? "");
                          await exportRagPdf({
                            weekStart,
                            lines,
                            entries,
                            autoDtBucketMap,
                            comments: cMap,
                            generatedBy: profile?.name || user?.email || "System",
                          });
                        } catch (e) { toast.error((e as Error).message); }
                      }}
                    >
                      <FileText className="h-4 w-4 mr-2" />Download PDF
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={async () => {
                        try {
                          const weekStartStrLocal = format(weekStart, "yyyy-MM-dd");
                          const { data: cRows } = await (supabase as any)
                            .from("rag_weekly_comments")
                            .select("line, comment")
                            .eq("week_start", weekStartStrLocal);
                          const cMap = new Map<string, string>();
                          for (const r of (cRows ?? []) as { line: string; comment: string }[]) cMap.set(r.line, r.comment ?? "");
                          exportRagExcel({
                            weekStart,
                            lines,
                            entries,
                            autoDtBucketMap,
                            comments: cMap,
                            generatedBy: profile?.name || user?.email || "System",
                          });
                        } catch (e) { toast.error((e as Error).message); }
                      }}
                    >
                      <FileSpreadsheet className="h-4 w-4 mr-2" />Download Excel
                    </DropdownMenuItem>

                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap border-t pt-3">
              <Button size="icon" variant="ghost" onClick={() => setWeekStart(startOfWeek(addDays(monthAnchor, -1), { weekStartsOn: 1 }))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm font-medium min-w-[110px] text-center">{format(monthAnchor, "MMMM yyyy")}</span>
              <Button size="icon" variant="ghost" onClick={() => setWeekStart(startOfWeek(addDays(endOfMonth(monthAnchor), 1), { weekStartsOn: 1 }))}>
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="ml-1">
                    <CalendarIcon className="h-4 w-4 mr-1" />
                    {format(weekStart, "dd MMM")} – {format(addDays(weekStart, 6), "dd MMM yyyy")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={weekStart}
                    onSelect={(d) => d && setWeekStart(startOfWeek(d, { weekStartsOn: 1 }))}
                    weekStartsOn={1}
                    showWeekNumber
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
              <div className="flex flex-wrap gap-1 ml-2">
                {monthWeeks.map((w) => {
                  const active = format(w, "yyyy-MM-dd") === weekStartStr;
                  const inMonth = isSameMonth(w, monthAnchor) || isSameMonth(addDays(w, 6), monthAnchor);
                  return (
                    <Button
                      key={w.toISOString()}
                      size="sm"
                      variant={active ? "default" : "outline"}
                      className={!inMonth ? "opacity-50" : ""}
                      onClick={() => setWeekStart(w)}
                    >
                      W{getISOWeek(w)} · {format(w, "dd/MM")}
                    </Button>
                  );
                })}
              </div>
            </div>
          </CardHeader>
        </Card>
        {inconsistencies.length > 0 && (
          <Card className="border-warning/50 bg-warning/5">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-warning text-base">
                <AlertOctagon className="h-4 w-4" />
                Downtime consistency check — {inconsistencies.length} WO(s) span multiple shifts
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs space-y-1">
              <p className="text-muted-foreground">
                The following Work Orders contribute minutes to more than one (date · line · shift) cell.
                Splitting across the 06:00/18:00 boundary is expected; review to confirm no double-counting.
              </p>
              <div className="max-h-40 overflow-auto mt-2 space-y-1">
                {inconsistencies.slice(0, 25).map((r) => (
                  <div key={r.ref} className="flex flex-wrap gap-2 items-center border-l-2 border-warning/60 pl-2 py-0.5">
                    <span className="font-mono font-semibold">WO #{r.ref}</span>
                    <span className="text-muted-foreground">{r.line}</span>
                    <span className="text-muted-foreground">· total {r.total} min across {r.cells.length} shifts:</span>
                    {r.cells.map((c) => (
                      <span key={c.key} className="px-1.5 py-0.5 rounded bg-warning/15">
                        {c.key.split("|")[0]} {c.key.split("|")[2]} ({c.minutes}m)
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}


        <DayNightTotalSummary
          lines={lines}
          weekDates={weekDates}
          entryMap={entryMap}
          autoDtMap={autoDtMap}
          autoDtBucketMap={autoDtBucketMap}
          autoDtBreakdown={autoDtBreakdown}
          cellScrapMap={cellScrapMap}
          cellItemTargetMap={cellItemTargetMap}
          isAdmin={isAdmin}
          canEditEntries={canEditRagEntries}
          canComment={canComment}
          weekStartStr={weekStartStr}
          onSave={(payload) => upsertMutation.mutate(payload)}
          onOpenFull={(date, line, shift) => {
            const e = entryMap.get(`${date}|${line}|${shift}`);
            setEditing({ date, line, shift, entry: e });
          }}
        />









        {entries.some((e) => e.notes) && (
          <Card>
            <CardHeader><CardTitle>Notes</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {entries.filter((e) => e.notes).map((e) => (
                <div key={e.id} className="border-l-2 border-primary/40 pl-3">
                  <div className="text-xs text-muted-foreground">
                    {e.entry_date} · {e.line} · {e.shift}
                  </div>
                  <div>{e.notes}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      {editing && (
        <EditDialog
          key={`${editing.date}-${editing.line}-${editing.shift}`}
          editing={editing}
          onClose={() => setEditing(null)}
          onSave={(payload) => upsertMutation.mutate(payload)}
          saving={upsertMutation.isPending}
        />
      )}

      <ManageLinesDialog open={manageLinesOpen} onOpenChange={setManageLinesOpen} />
    </DashboardLayout>
  );
}

function InlineCell({
  entry, date, line, shift, onSave, onOpenFull,
}: {
  entry?: Entry;
  date: string;
  line: string;
  shift: Shift;
  onSave: (payload: Omit<Entry, "id">) => void;
  onOpenFull: () => void;
}) {
  const [plan, setPlan] = useState<string>(entry?.plan_qty?.toString() ?? "");
  const [actual, setActual] = useState<string>(entry?.actual_qty?.toString() ?? "");
  const [dt, setDt] = useState<string>(entry?.downtime_min?.toString() ?? "");
  const focusedRef = useRef<"plan" | "actual" | "dt" | null>(null);

  useEffect(() => {
    // Skip the field currently being edited so realtime refetch doesn't blur/overwrite the user's typing.
    if (focusedRef.current !== "plan") setPlan(entry?.plan_qty?.toString() ?? "");
    if (focusedRef.current !== "actual") setActual(entry?.actual_qty?.toString() ?? "");
    if (focusedRef.current !== "dt") setDt(entry?.downtime_min?.toString() ?? "");
  }, [entry?.id, entry?.plan_qty, entry?.actual_qty, entry?.downtime_min]);

  const commit = (next: { plan?: string; actual?: string; dt?: string }) => {
    const p = Number(next.plan ?? plan) || 0;
    const a = Number(next.actual ?? actual) || 0;
    const d = Number(next.dt ?? dt) || 0;
    if (
      p === (entry?.plan_qty ?? 0) &&
      a === (entry?.actual_qty ?? 0) &&
      d === (entry?.downtime_min ?? 0)
    ) return;
    onSave({
      entry_date: date,
      line,
      shift,
      plan_qty: p,
      actual_qty: a,
      upm_target: entry?.upm_target ?? 0,
      upm_actual: entry?.upm_actual ?? 0,
      downtime_min: d,
      notes: entry?.notes ?? null,
    });
  };

  const inputCls = "h-6 w-14 px-1 text-center text-[11px] bg-background/60 border rounded";

  return (
    <div className="flex flex-col items-center gap-0.5">
      <input
        className={`${inputCls} font-semibold`}
        type="number"
        value={actual}
        placeholder="Act"
        onFocus={() => { focusedRef.current = "actual"; }}
        onChange={(e) => setActual(e.target.value)}
        onBlur={() => { focusedRef.current = null; commit({ actual }); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      />
      <input
        className={`${inputCls} opacity-80`}
        type="number"
        value={plan}
        placeholder="Plan"
        onFocus={() => { focusedRef.current = "plan"; }}
        onChange={(e) => setPlan(e.target.value)}
        onBlur={() => { focusedRef.current = null; commit({ plan }); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      />
      <input
        className={`${inputCls} text-destructive`}
        type="number"
        value={dt}
        placeholder="DT"
        onFocus={() => { focusedRef.current = "dt"; }}
        onChange={(e) => setDt(e.target.value)}
        onBlur={() => { focusedRef.current = null; commit({ dt }); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      />

      <button
        type="button"
        onClick={onOpenFull}
        className="text-[10px] text-muted-foreground hover:text-foreground underline"
      >
        more…
      </button>
    </div>
  );
}

function EditDialog({
  editing, onClose, onSave, saving,
}: {
  editing: { date: string; line: string; shift: Shift; entry?: Entry };
  onClose: () => void;
  onSave: (e: Omit<Entry, "id">) => void;
  saving: boolean;
}) {
  const [plan, setPlan] = useState(editing.entry?.plan_qty ?? 0);
  const [actual, setActual] = useState(editing.entry?.actual_qty ?? 0);
  const [upmT, setUpmT] = useState(editing.entry?.upm_target ?? 0);
  const [upmA, setUpmA] = useState(editing.entry?.upm_actual ?? 0);
  const [dt, setDt] = useState(editing.entry?.downtime_min ?? 0);
  const [shift, setShift] = useState<Shift>(editing.shift);
  const [notes, setNotes] = useState(editing.entry?.notes ?? "");

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing.line} · {editing.date}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>Shift</Label>
            <Select value={shift} onValueChange={(v) => setShift(v as Shift)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="DAY">Day</SelectItem>
                <SelectItem value="NIGHT">Night</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Plan</Label><Input type="number" value={plan} onChange={(e) => setPlan(Number(e.target.value))} /></div>
            <div><Label>Actual <span className="text-xs text-muted-foreground">(auto from tablet, admin can override)</span></Label><Input type="number" value={actual} onChange={(e) => setActual(Number(e.target.value) || 0)} /></div>
            <div><Label>UPM Target</Label><Input type="number" value={upmT} onChange={(e) => setUpmT(Number(e.target.value))} /></div>
            <div><Label>UPM Actual</Label><Input type="number" value={upmA} onChange={(e) => setUpmA(Number(e.target.value))} /></div>
            <div className="col-span-2"><Label>Downtime (min)</Label><Input type="number" value={dt} onChange={(e) => setDt(Number(e.target.value))} /></div>
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>
          {plan > 0 && (
            <div className="text-sm text-muted-foreground">
              Variance: <span className="font-medium">{((actual / plan) * 100).toFixed(1)}%</span>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={saving}
            onClick={() => onSave({
              entry_date: editing.date,
              line: editing.line,
              shift,
              plan_qty: plan,
              actual_qty: actual,
              upm_target: upmT,
              upm_actual: upmA,
              downtime_min: dt,
              notes: notes || null,
            })}
          >{saving ? "Saving..." : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────
// Day / Night / Total summary table (mirrors leadership layout)
// Columns: per weekday × {Day | Night | Total}
// Rows per line: Plan / Actual / Variance % / UPM / Downtime (h:mm)
// Plus a grand-total "All Lines" block at the bottom.
// ─────────────────────────────────────────────────────────────
function DayNightTotalSummary({
  lines,
  weekDates,
  entryMap,
  autoDtMap,
  autoDtBucketMap,
  autoDtBreakdown,
  cellScrapMap,
  cellItemTargetMap,
  isAdmin = false,
  canEditEntries = false,
  canComment = false,
  weekStartStr,
  onSave,
  onOpenFull,
}: {
  lines: string[];
  weekDates: Date[];
  entryMap: Map<string, Entry>;
  autoDtMap?: Map<string, number>;
  autoDtBucketMap?: Map<string, Map<string, number>>;
  autoDtBreakdown?: Map<string, ClampedStop[]>;
  cellScrapMap?: Map<string, number>;
  cellItemTargetMap?: Map<string, number>;
  isAdmin?: boolean;
  canEditEntries?: boolean;
  canComment?: boolean;
  weekStartStr?: string;
  onSave?: (payload: Omit<Entry, "id">) => void;
  onOpenFull?: (date: string, line: string, shift: Shift) => void;
}) {


  const qcExcl = useQueryClient();
  const fromDate = weekDates.length ? format(weekDates[0], "yyyy-MM-dd") : null;
  const toDate = weekDates.length ? format(weekDates[weekDates.length - 1], "yyyy-MM-dd") : null;

  const COLLAPSE_KEY = "rag-weekly-collapsed-lines";
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem(COLLAPSE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(collapsed)); } catch { /* noop */ }
  }, [collapsed]);
  const toggleCollapsed = (label: string) =>
    setCollapsed((prev) => ({ ...prev, [label]: !prev[label] }));
  const allLabels = [...lines, "All Lines"];
  const allCollapsed = allLabels.every((l) => collapsed[l]);
  const setAll = (val: boolean) => {
    const next: Record<string, boolean> = {};
    allLabels.forEach((l) => { next[l] = val; });
    setCollapsed(next);
  };

  const { data: exclusionRows = [] } = useQuery({
    queryKey: ["rag-exclusions", fromDate, toDate],
    enabled: !!fromDate && !!toDate,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rag_week_exclusions")
        .select("entry_date,line,shift")
        .gte("entry_date", fromDate!)
        .lte("entry_date", toDate!);
      if (error) throw error;
      return (data ?? []) as { entry_date: string; line: string; shift: "DAY" | "NIGHT" | "ALL" }[];
    },
  });

  // Comments per line per day for the week
  const { data: commentRows = [] } = useQuery({
    queryKey: ["rag-comments", fromDate, toDate],
    enabled: !!fromDate && !!toDate,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("rag_weekly_comments")
        .select("line, comment, entry_date")
        .gte("entry_date", fromDate!)
        .lte("entry_date", toDate!);
      if (error) throw error;
      return (data ?? []) as { line: string; comment: string; entry_date: string }[];
    },
  });
  const commentMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of commentRows) m.set(`${r.line}|${r.entry_date}`, r.comment ?? "");
    return m;
  }, [commentRows]);

  useEffect(() => {
    if (!weekStartStr) return;
    const ch = supabase
      .channel(`rag-comments-${weekStartStr}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "rag_weekly_comments" }, () => {
        qcExcl.invalidateQueries({ queryKey: ["rag-comments", weekStartStr] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [weekStartStr, qcExcl]);

  useEffect(() => {
    if (!fromDate || !toDate) return;
    const ch = supabase
      .channel(`rag-exclusions-${fromDate}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "rag_week_exclusions" }, () => {
        qcExcl.invalidateQueries({ queryKey: ["rag-exclusions", fromDate, toDate] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [fromDate, toDate, qcExcl]);

  const excludedDates = useMemo(() => {
    const s = new Set<string>();
    for (const r of exclusionRows) {
      s.add(r.shift === "ALL" ? `${r.line}|${r.entry_date}` : `${r.line}|${r.entry_date}|${r.shift}`);
    }
    return s;
  }, [exclusionRows]);

  const toggleExclusion = async (line: string, ds: string, shift: "DAY" | "NIGHT" | "ALL") => {
    const exists = exclusionRows.some(r => r.line === line && r.entry_date === ds && r.shift === shift);
    if (exists) {
      const { error } = await supabase.from("rag_week_exclusions").delete()
        .eq("line", line).eq("entry_date", ds).eq("shift", shift);
      if (error) { toast.error(error.message); return; }
    } else {
      const { error } = await supabase.from("rag_week_exclusions")
        .insert({ line, entry_date: ds, shift });
      if (error) { toast.error(error.message); return; }
    }
    qcExcl.invalidateQueries({ queryKey: ["rag-exclusions", fromDate, toDate] });
  };
  const toggleDate = (label: string, ds: string) => toggleExclusion(label, ds, "ALL");
  const toggleShift = (label: string, ds: string, shift: Shift) => toggleExclusion(label, ds, shift);
  const isDateExcluded = (label: string, ds: string) => excludedDates.has(`${label}|${ds}`);
  const isShiftExcluded = (label: string, ds: string, shift: Shift) =>
    excludedDates.has(`${label}|${ds}`) || excludedDates.has(`${label}|${ds}|${shift}`);

  // All non-empty bucket names found anywhere in the auto map.
  // IMPORTANT: hook must run on every render — keep it ABOVE any early return.
  const allBucketNames = useMemo(() => {
    return Array.from(autoDtBucketMap?.keys() ?? []);
  }, [autoDtBucketMap]);

  if (!lines.length) return null;

  const fmtHm = (min: number) => {
    if (!min || min <= 0) return "—";
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return `${h}:${m.toString().padStart(2, "0")}`;
  };
  const pct = (a: number, p: number) => {
    const plan = Number(p) || 0;
    const actual = Number(a) || 0;
    if (plan <= 0 && actual <= 0) return "—";
    if (plan <= 0 && actual > 0) return "N/A";
    if (plan > 0 && actual <= 0) return "-100%";
    return `${Math.round(((actual - plan) / plan) * 100)}%`;
  };
  const pctClass = (a: number, p: number) => {
    const plan = Number(p) || 0;
    const actual = Number(a) || 0;
    if (plan <= 0) return "text-muted-foreground";
    if (actual <= 0) return "bg-destructive/10 text-destructive font-semibold rounded px-1.5";
    if (actual >= plan) return "bg-success/15 text-success font-semibold rounded px-1.5";
    const r = (actual / plan) * 100;
    if (r >= 90) return "bg-warning/15 text-warning font-semibold rounded px-1.5";
    return "bg-destructive/10 text-destructive font-semibold rounded px-1.5";
  };

  type Cell = {
    plan: number;
    actual: number;
    dt: number;
    dtBuckets: Record<string, number>;
    upm: number;
  };
  const empty: Cell = { plan: 0, actual: 0, dt: 0, dtBuckets: {}, upm: 0 };


  const getCell = (dateStr: string, line: string, shift: Shift): Cell => {
    const key = `${dateStr}|${line}|${shift}`;
    const e = entryMap.get(key);
    const dtBuckets: Record<string, number> = {};
    let auto = 0;
    for (const bucket of allBucketNames) {
      const m = autoDtBucketMap?.get(bucket)?.get(key) ?? 0;
      if (m > 0) {
        dtBuckets[bucket] = m;
        auto += m;
      }
    }
    // When there's no auto downtime at all, fall back to the manually entered
    // total and attribute it to MAINT so the column still shows something.
    if (auto === 0) {
      const manual = Number(e?.downtime_min) || 0;
      if (manual > 0) {
        dtBuckets["MAINT"] = manual;
        auto = manual;
      }
    }
    if (!e) return { ...empty, dt: auto, dtBuckets };
    return {
      plan: Number(e.plan_qty) || 0,
      actual: Number(e.actual_qty) || 0,
      dt: auto,
      dtBuckets,
      upm: Number(e.upm_actual) || 0,
    };
  };

  const sumCells = (cells: Cell[]): Cell => {
    const upms = cells.map((c) => c.upm).filter((v) => v > 0);
    const dtBuckets: Record<string, number> = {};
    for (const c of cells) {
      for (const [b, m] of Object.entries(c.dtBuckets)) {
        dtBuckets[b] = (dtBuckets[b] ?? 0) + m;
      }
    }
    return {
      plan: cells.reduce((s, c) => s + c.plan, 0),
      actual: cells.reduce((s, c) => s + c.actual, 0),
      dt: cells.reduce((s, c) => s + c.dt, 0),
      dtBuckets,
      upm: upms.length ? upms.reduce((s, v) => s + v, 0) / upms.length : 0,
    };
  };

  const Block = ({ label, lineFilter }: { label: string; lineFilter: string[] }) => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const scroll = (dx: number) => scrollRef.current?.scrollBy({ left: dx, behavior: "smooth" });
    const [showLeft, setShowLeft] = useState(false);
    const [showRight, setShowRight] = useState(false);
    const updateScroll = () => {
      const el = scrollRef.current;
      if (!el) return;
      const canScroll = el.scrollWidth > el.clientWidth + 1;
      setShowLeft(canScroll && el.scrollLeft > 0);
      setShowRight(canScroll && el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    };
    useEffect(() => {
      updateScroll();
      const onResize = () => updateScroll();
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }, []);

    const buildCol = (dateStr: string, shift: Shift | "TOTAL"): Cell => {
      if (shift === "TOTAL") {
        return sumCells(lineFilter.flatMap((l) => [getCell(dateStr, l, "DAY"), getCell(dateStr, l, "NIGHT")]));
      }
      return sumCells(lineFilter.map((l) => getCell(dateStr, l, shift)));
    };

    const weekTotal = (shift: Shift | "TOTAL"): Cell => {
      const cells: Cell[] = [];
      for (const d of weekDates) {
        const ds = format(d, "yyyy-MM-dd");
        if (isDateExcluded(label, ds)) continue;
        if (shift === "TOTAL") {
          const inc: Cell[] = [];
          if (!isShiftExcluded(label, ds, "DAY")) inc.push(buildCol(ds, "DAY"));
          if (!isShiftExcluded(label, ds, "NIGHT")) inc.push(buildCol(ds, "NIGHT"));
          cells.push(sumCells(inc));
        } else {
          if (isShiftExcluded(label, ds, shift)) continue;
          cells.push(buildCol(ds, shift));
        }
      }
      return sumCells(cells);
    };



    // Discover which downtime buckets actually have minutes in the visible
    // block (all visible dates, both shifts, all filtered lines). One table
    // row will be rendered per bucket so categories never collapse into a
    // single "DOWNTIME · MAINT" line.
    const visibleBuckets = (() => {
      const totals = new Map<string, number>();
      for (const d of weekDates) {
        const ds = format(d, "yyyy-MM-dd");
        for (const shift of ["DAY", "NIGHT"] as Shift[]) {
          for (const ln of lineFilter) {
            const c = getCell(ds, ln, shift);
            for (const [b, m] of Object.entries(c.dtBuckets)) {
              totals.set(b, (totals.get(b) ?? 0) + m);
            }
          }
        }
      }
      // Stable display order: MAINT (iTouching) first, then WO Request, Quality, then alphabetical.
      const names = Array.from(totals.keys()).filter((b) => (totals.get(b) ?? 0) > 0);
      const rank = (b: string) =>
        b === "MAINT" ? 0 : b === "WO Request" ? 1 : b === "Quality" ? 2 : 3;
      names.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
      return names;
    })();

    const bucketClass = (b: string) =>
      b === "MAINT"
        ? "text-destructive"
        : b === "WO Request"
        ? "text-warning"
        : b === "Quality"
        ? "text-warning"
        : b === "Break"
        ? "text-primary"
        : b === "Cleaning"
        ? "text-primary"
        : b === "Changeover"
        ? "text-accent-foreground"
        : "text-muted-foreground";


    const rows: { key: string; label: string; render: (c: Cell) => React.ReactNode; bold?: boolean; bucket?: string }[] = [
      { key: "plan", label: "Plan", render: (c) => c.plan ? c.plan.toLocaleString() : "—" },
      { key: "actual", label: "Actual", render: (c) => c.actual ? c.actual.toLocaleString() : "—", bold: true },
      {
        key: "var",
        label: "Variance %",
        render: (c) => <span className={pctClass(c.actual, c.plan)}>{pct(c.actual, c.plan)}</span>,
      },
      { key: "upm", label: "UPM", render: (c) => (c.upm ? c.upm.toFixed(2) : "—") },
      ...visibleBuckets.map((b) => ({
        key: `dt:${b}`,
        label:
          b === "MAINT"
            ? "Maint Downtime (iTouching)"
            : b === "WO Request"
            ? "WO Requests (internal)"
            : `Downtime · ${b}`,
        bucket: b,

        render: (c: Cell) => {
          const v = c.dtBuckets[b] ?? 0;
          return <span className={v > 0 ? bucketClass(b) : ""}>{fmtHm(v)}</span>;
        },
      })),
    ];

    const isCollapsed = !!collapsed[label];
    return (
      <div key={label} className="mb-6">
        <div className="flex items-center justify-between mb-1 gap-2">
          <button
            type="button"
            onClick={() => toggleCollapsed(label)}
            className="flex items-center gap-2 font-semibold text-sm uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
            aria-expanded={!isCollapsed}
            aria-label={isCollapsed ? `Expand ${label}` : `Collapse ${label}`}
          >
            {isCollapsed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            <span>{label === "All Lines" ? label : displayLineLabel(label)}</span>
            {isCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>
          {!isCollapsed && (
            <div className="flex gap-1 md:hidden">
              <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => scroll(-220)} aria-label="Scroll left">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => scroll(220)} aria-label="Scroll right">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
        {isCollapsed ? null : (
        <div className="relative">
          <div
            ref={scrollRef}
            className="overflow-x-auto overflow-y-hidden -mx-2 px-2 scroll-smooth border rounded-md shadow-sm"
            onScroll={updateScroll}
            onWheel={(e) => {
              // Do not trap vertical wheel — forward it to the page so users can
              // scroll normally with the cursor over the wide table.
              if (e.deltaY !== 0 && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                window.scrollBy({ top: e.deltaY });
                e.preventDefault();
              }
            }}
          >

            <table className="text-xs border-collapse min-w-[1000px] w-full tabular-nums">
              <thead className="sticky top-0 z-30 bg-background shadow-[0_2px_0_0_hsl(var(--border))]">
                <tr className="border-b bg-background">
                  <th className="text-left p-1.5 sticky left-0 bg-background z-30 min-w-[100px]" />
                  {weekDates.map((d, i) => {
                    const ds = format(d, "yyyy-MM-dd");
                    const excluded = isDateExcluded(label, ds);
                    return (
                      <th key={i} colSpan={3} className={`text-center p-1.5 border-l whitespace-nowrap ${excluded ? "bg-muted/60 text-muted-foreground" : "bg-background"}`}>
                        <div className="flex items-center justify-center gap-1">
                          <span>{DAY_LABELS[i]}</span>
                          <button
                            type="button"
                            onClick={() => toggleDate(label, ds)}
                            title={excluded ? "Include in week total" : "Exclude from week total"}
                            className={`text-[9px] px-1.5 py-0.5 rounded border font-bold leading-none ${excluded ? "bg-muted text-muted-foreground border-border" : "bg-success/15 text-success border-success/40"}`}
                          >
                            {excluded ? "OFF" : "ON"}
                          </button>
                        </div>
                        <div className="text-muted-foreground font-normal">{format(d, "dd-MMM-yy")}</div>
                      </th>
                    );
                  })}

                  <th colSpan={3} className="text-center p-1.5 border-l whitespace-nowrap bg-primary/10 font-semibold">
                    <div>Week Total</div>
                    <div className="text-muted-foreground font-normal">All Days</div>
                  </th>
                </tr>
                <tr className="border-b bg-muted/40">
                  <th className="sticky left-0 bg-muted/40 z-30" />
                  {weekDates.map((d, i) => {
                    const ds = format(d, "yyyy-MM-dd");
                    const dayOff = isShiftExcluded(label, ds, "DAY");
                    const nightOff = isShiftExcluded(label, ds, "NIGHT");
                    const Btn = ({ off, onClick }: { off: boolean; onClick: () => void }) => (
                      <button
                        type="button"
                        onClick={onClick}
                        title={off ? "Include shift" : "Exclude shift"}
                        className={`ml-1 text-[8px] px-1 py-0 rounded border font-bold leading-none align-middle ${off ? "bg-muted text-muted-foreground border-border" : "bg-success/15 text-success border-success/40"}`}
                      >
                        {off ? "off" : "on"}
                      </button>
                    );
                    return (
                      <Fragment key={i}>
                        <th className={`text-right p-1 border-l font-medium min-w-[60px] ${dayOff ? "bg-muted/60 text-muted-foreground" : "bg-muted/40 text-warning"}`}>
                          Day<Btn off={dayOff} onClick={() => toggleShift(label, ds, "DAY")} />
                        </th>
                        <th className={`text-right p-1 font-medium min-w-[60px] ${nightOff ? "bg-muted/60 text-muted-foreground" : "bg-muted/40 text-primary"}`}>
                          Night<Btn off={nightOff} onClick={() => toggleShift(label, ds, "NIGHT")} />
                        </th>
                        <th className="text-right p-1 font-semibold bg-muted/60 min-w-[60px]">Total</th>
                      </Fragment>
                    );
                  })}
                  <th className="text-right p-1 border-l text-warning font-medium bg-primary/10 min-w-[64px]">Day</th>
                  <th className="text-right p-1 text-primary font-medium bg-primary/10 min-w-[64px]">Night</th>
                  <th className="text-right p-1 font-bold bg-primary/15 min-w-[64px]">Total</th>
                </tr>

              </thead>
              <tbody>
                {rows.map((row) => {
                  const wtDay = weekTotal("DAY");
                  const wtNight = weekTotal("NIGHT");
                  const wtTot = weekTotal("TOTAL");
                  const cls = `p-1.5 text-right whitespace-nowrap tabular-nums ${row.bold ? "font-semibold" : ""}`;
                  const editable = canEditEntries && lineFilter.length === 1 && ["plan", "actual"].includes(row.key);
                  const lineName = lineFilter[0];
                  const commitValue = async (ds: string, shift: Shift, v: number) => {
                    const existing = entryMap.get(`${ds}|${lineName}|${shift}`);
                    const patch: Partial<Entry> =
                      row.key === "plan" ? { plan_qty: v }
                      : row.key === "actual" ? { actual_qty: v }
                      : { downtime_min: v };
                    if (existing?.id) {
                      // Patch ONLY the edited field so we never clobber
                      // sibling values (actual, downtime, notes, etc.).
                      const { error } = await supabase
                        .from("rag_weekly_entries")
                        .update(patch)
                        .eq("id", existing.id);
                      if (error) { toast.error(error.message); return; }
                      toast.success("Saved");
                      qcExcl.invalidateQueries({ queryKey: ["rag-week", weekStartStr] });
                    } else if (onSave) {
                      onSave({
                        entry_date: ds,
                        line: lineName,
                        shift,
                        plan_qty: row.key === "plan" ? v : 0,
                        actual_qty: row.key === "actual" ? v : 0,
                        upm_target: 0,
                        upm_actual: 0,
                        downtime_min: row.key === "dt" ? v : 0,
                        notes: null,
                      });
                    }
                  };
                  const renderEdit = (ds: string, shift: Shift) => {
                    const existing = entryMap.get(`${ds}|${lineName}|${shift}`);
                    const current =
                      row.key === "plan" ? (existing?.plan_qty ?? 0)
                      : row.key === "actual" ? (existing?.actual_qty ?? 0)
                      : (existing?.downtime_min ?? 0);
                    const input = (
                      <SummaryInlineInput
                        value={current}
                        onCommit={(v) => commitValue(ds, shift, v)}
                        onOpen={() => onOpenFull?.(ds, lineName, shift)}
                      />
                    );
                    if (row.key !== "plan") return input;
                    // Plan (target) row: quick "+1%" stretch button. Each click compounds
                    // ×1.01 (rounded), guaranteeing at least +1 so small targets still move.
                    const bump = () => {
                      if (current <= 0) return;
                      commitValue(ds, shift, Math.max(current + 1, Math.round(current * 1.01)));
                    };
                    return (
                      <div className="flex items-center justify-end gap-0.5">
                        <span className="min-w-0 flex-1">{input}</span>
                        <button
                          type="button"
                          onClick={bump}
                          title="Increase target by 1%"
                          className="shrink-0 rounded px-1 text-[9px] font-semibold leading-none text-primary hover:bg-primary/10"
                        >
                          +1%
                        </button>
                      </div>
                    );
                  };
                  const isDt = row.key.startsWith("dt:");
                  const dtBucket: string | null = isDt ? (row.bucket ?? row.key.slice(3)) : null;
                  const isPlan = row.key === "plan";
                  const wrapDt = (ds: string, shift: Shift, cellEl: React.ReactNode) => {
                    if (!isDt || lineFilter.length !== 1) return cellEl;
                    const key = `${ds}|${lineFilter[0]}|${shift}`;
                    const all = autoDtBreakdown?.get(key) ?? [];
                    const details = dtBucket ? all.filter((s) => s.kind === dtBucket) : all;
                    if (!details.length) return cellEl;
                    const scrap = cellScrapMap?.get(key) ?? 0;
                    return <DowntimeBreakdownPopover trigger={cellEl} stops={details} dateStr={ds} shift={shift} line={lineFilter[0]} totalScrap={scrap} />;
                  };
                  const wrapPlan = (ds: string, shift: Shift, cellEl: React.ReactNode) => {
                    if (!isPlan || lineFilter.length !== 1) return cellEl;
                    const key = `${ds}|${lineFilter[0]}|${shift}`;
                    const e = entryMap.get(key);
                    const itemSum = cellItemTargetMap?.get(key) ?? 0;
                    const plan = Number(e?.plan_qty ?? 0);
                    if (!plan || !itemSum) return cellEl;
                    const diff = Math.abs(plan - itemSum);
                    if (diff === 0) return cellEl;
                    return (
                      <span className="inline-flex items-center gap-1" title={`Plan ${plan} ≠ sum of SKU targets ${itemSum} (Δ${diff})`}>
                        {cellEl}
                        <span className="text-warning text-[10px] leading-none cursor-help" aria-label="rounding mismatch">⚠</span>
                      </span>
                    );
                  };
                  const wrapCell = (ds: string, shift: Shift, cellEl: React.ReactNode) =>
                    isDt ? wrapDt(ds, shift, cellEl) : isPlan ? wrapPlan(ds, shift, cellEl) : cellEl;
                  return (
                    <tr key={row.key} className="border-b hover:bg-muted/20">
                      <td className="p-1.5 font-medium sticky left-0 bg-background z-10 whitespace-nowrap uppercase text-[11px] tracking-wide text-muted-foreground">{row.label}</td>
                      {weekDates.map((d, i) => {
                        const ds = format(d, "yyyy-MM-dd");
                        const dayDim = isShiftExcluded(label, ds, "DAY") ? "bg-muted/60 text-muted-foreground" : "";
                        const nightDim = isShiftExcluded(label, ds, "NIGHT") ? "bg-muted/60 text-muted-foreground" : "";
                        const totalDim = isDateExcluded(label, ds) ? "bg-muted/60 text-muted-foreground" : "bg-muted/40";
                        return (
                          <Fragment key={i}>
                            <td className={`${cls} border-l ${dayDim}`}>{editable ? renderEdit(ds, "DAY") : wrapCell(ds, "DAY", row.render(buildCol(ds, "DAY")))}</td>
                            <td className={`${cls} ${nightDim}`}>{editable ? renderEdit(ds, "NIGHT") : wrapCell(ds, "NIGHT", row.render(buildCol(ds, "NIGHT")))}</td>
                            <td className={`${cls} ${totalDim}`}>{row.render(buildCol(ds, "TOTAL"))}</td>
                          </Fragment>
                        );

                      })}


                      <td className={`${cls} border-l bg-primary/5`}>{row.render(wtDay)}</td>
                      <td className={`${cls} bg-primary/5`}>{row.render(wtNight)}</td>
                      <td className={`${cls} bg-primary/15 font-bold`}>{row.render(wtTot)}</td>
                    </tr>
                  );
                })}
              </tbody>

            </table>
          </div>
          {/* Horizontal-scroll hint: desktop-only gradient overlays that fade out when the edge is reached. */}
          <div
            className={cn(
              "pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-background to-transparent transition-opacity duration-300 hidden md:block",
              showLeft ? "opacity-100" : "opacity-0"
            )}
            aria-hidden="true"
          />
          <div
            className={cn(
              "pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent transition-opacity duration-300 hidden md:block",
              showRight ? "opacity-100" : "opacity-0"
            )}
            aria-hidden="true"
          />
        </div>
        )}
        {!isCollapsed && label !== "All Lines" && (
          <div className="mt-2 border rounded-md bg-muted/10 p-3">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Daily Comments</div>
            <div className="grid gap-2 md:grid-cols-7">
              {weekDates.map((d) => {
                const ds = format(d, "yyyy-MM-dd");
                return (
                  <LineCommentBox
                    key={ds}
                    line={label}
                    entryDate={ds}
                    dayLabel={format(d, "EEE dd/MM")}
                    initialValue={commentMap.get(`${label}|${ds}`) ?? ""}
                    canEdit={canComment}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };




  return (
    <Card className="border-l-4 border-l-amber-500 shadow-md">
      <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base uppercase tracking-wider text-muted-foreground">Day / Night / Total Summary</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setAll(!allCollapsed)}>
          {allCollapsed ? <><Eye className="h-4 w-4 mr-1" />Expand All</> : <><EyeOff className="h-4 w-4 mr-1" />Collapse All</>}
        </Button>
      </CardHeader>
      <CardContent>

        {lines.length === 0 ? (
          <EmptyState
            title="No lines to display"
            description="No lines match the current filters for the selected week. Adjust the week or line filter above to see the RAG summary."
          />
        ) : (
          <>
            {lines.map((line) => (
              <div key={line} id={`rag-line-${line.replace(/\s+/g, "-")}`} className="scroll-mt-24">
                <Block label={line} lineFilter={[line]} />
              </div>
            ))}
            <div id="rag-line-all" className="scroll-mt-24">
              <Block label="All Lines" lineFilter={lines} />
            </div>
          </>
        )}

      </CardContent>
    </Card>
  );
}

function LineCommentBox({
  line,
  entryDate,
  dayLabel,
  initialValue,
  canEdit,
}: {
  line: string;
  entryDate: string;
  dayLabel: string;
  initialValue: string;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const [value, setValue] = useState<string>(initialValue ?? "");
  const [saving, setSaving] = useState(false);
  const focusedRef = useRef(false);
  useEffect(() => {
    if (!focusedRef.current) setValue(initialValue ?? "");
  }, [initialValue, line, entryDate]);

  const commit = async () => {
    focusedRef.current = false;
    const next = value.trim();
    if (next === (initialValue ?? "").trim()) return;
    if (!canEdit) return;
    setSaving(true);
    const { error } = await (supabase as any)
      .from("rag_weekly_comments")
      .upsert(
        {
          line,
          entry_date: entryDate,
          week_start: entryDate,
          comment: next,
          updated_by: (await supabase.auth.getUser()).data.user?.id ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "line,entry_date" },
      );
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["rag-comments"] });
  };

  return (
    <div className="border rounded-md bg-card p-2">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{dayLabel}</div>
        {saving && <div className="text-[10px] text-muted-foreground">…</div>}
      </div>
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={() => { focusedRef.current = true; }}
        onBlur={commit}
        disabled={!canEdit}
        placeholder="Notes…"
        rows={2}
        className="min-h-[44px] resize-y text-xs bg-background text-foreground"
      />
    </div>
  );
}



function SummaryInlineInput({
  value,
  onCommit,
  onOpen,
}: {
  value: number;
  onCommit: (v: number) => void;
  onOpen?: () => void;
}) {
  const [v, setV] = useState<string>(value ? String(value) : "");
  const focusedRef = useRef(false);
  useEffect(() => {
    if (!focusedRef.current) setV(value ? String(value) : "");
  }, [value]);
  const commit = () => {
    focusedRef.current = false;
    const n = Number(v.replace(/[, ]/g, ""));
    const next = isNaN(n) ? 0 : n;
    if (next !== value) onCommit(next);
  };
  return (
    <input
      type="text"
      inputMode="numeric"
      value={v}
      placeholder="—"
      onFocus={() => { focusedRef.current = true; }}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") { focusedRef.current = false; setV(value ? String(value) : ""); }
      }}
      onDoubleClick={() => onOpen?.()}
      className="w-full bg-transparent text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-primary/50 rounded px-1"
      title="Double-click to open full editor"
    />
  );
}

function DowntimeBreakdownPopover({
  trigger, stops, dateStr, shift, line, totalScrap = 0,
}: {
  trigger: React.ReactNode;
  stops: ClampedStop[];
  dateStr: string;
  shift: Shift;
  line: string;
  totalScrap?: number;
}) {
  const fmtTs = (iso: string) =>
    new Date(iso).toLocaleString("en-GB", {
      timeZone: "Europe/London",
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
    });
  const totalMin = stops.reduce((s, x) => s + x.minutes, 0);
  const statusBadge = (st?: string | null) => {
    if (!st) return null;
    const s = String(st).toLowerCase();
    const tone =
      ["finished","closed","completed","force_closed"].includes(s) ? "bg-success/15 text-success" :
      ["in_progress","arrived","received"].includes(s) ? "bg-primary/15 text-primary" :
      s === "open" ? "bg-destructive/15 text-destructive" :
      "bg-muted text-muted-foreground";
    return <span className={`ml-1 inline-block px-1 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${tone}`}>{s.replace("_"," ")}</span>;
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="w-full text-right cursor-help underline decoration-dotted decoration-muted-foreground/50 underline-offset-2">
          {trigger}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[440px] max-w-[92vw] p-0">
        <div className="px-3 py-2 border-b bg-muted/40">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{line} · {shift} · {dateStr}</div>
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold">{stops.length} stop{stops.length === 1 ? "" : "s"} · {totalMin}m total</div>
            {totalScrap > 0 && <div className="text-xs text-warning font-medium">Scrap: {totalScrap.toLocaleString()}</div>}
          </div>
          <Link
            to={`/dashboard/engineer?line=${encodeURIComponent(line)}&date=${encodeURIComponent(dateStr)}`}
            className="text-[11px] text-primary hover:underline"
          >
            Open Work Orders →
          </Link>
        </div>

        <div className="max-h-[320px] overflow-y-auto">
          <table className="w-full text-xs tabular-nums">
            <thead className="sticky top-0 bg-background border-b">
              <tr className="text-left">
                <th className="px-2 py-1.5 font-medium">Ref WO #</th>
                <th className="px-2 py-1.5 font-medium">Start</th>
                <th className="px-2 py-1.5 font-medium">End</th>
                <th className="px-2 py-1.5 font-medium text-right">Min</th>
              </tr>
            </thead>
            <tbody>
              {stops.map((s, i) => {
                const woLabel = s.source === "WO" && s.ref ? `WO #${s.ref}` : (s.ref ?? s.source);
                return (
                <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-2 py-1.5">
                    {s.source === "WO" && s.ref ? (
                      <a
                        href={`/dashboard/work-orders?wo=${encodeURIComponent(s.ref)}`}
                        className="font-mono text-[11px] text-primary hover:underline"
                      >
                        {woLabel}
                      </a>
                    ) : (
                      <div className="font-mono text-[11px]">{woLabel}</div>
                    )}
                    {statusBadge(s.status)}
                    {(s.machine || s.reason) && (
                      <div className="text-[10px] text-muted-foreground truncate max-w-[180px]" title={s.reason ?? ""}>
                        {[s.machine, s.reason].filter(Boolean).join(" — ")}
                      </div>
                    )}
                  </td>

                  <td className="px-2 py-1.5 font-mono text-[11px]">{fmtTs(s.clampedStart)}</td>
                  <td className="px-2 py-1.5 font-mono text-[11px]">
                    {s.ongoing ? <span className="text-destructive font-semibold">ongoing</span> : fmtTs(s.clampedEnd)}
                  </td>
                  <td className="px-2 py-1.5 text-right font-semibold">{s.minutes}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </PopoverContent>
    </Popover>
  );
}


