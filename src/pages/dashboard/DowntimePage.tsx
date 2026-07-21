import { PageHeader } from "@/components/ui/PageHeader";
import { useState, useMemo, useEffect, useRef } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Clock, Loader2, Plus, Pencil, Trash2, CheckCircle, AlertTriangle, Activity,
  TrendingUp, ChevronDown, History, Cog, Printer, FileText, FileSpreadsheet, Lightbulb,
} from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { ShiftBreakdownCard } from "@/components/ShiftBreakdownCard";
import { DateRangeFilter, type DateRangePreset, getPresetRange } from "@/components/DateRangeFilter";
import { useDowntime, useCreateDowntime, useUpdateDowntime, useDeleteDowntime, type DowntimeRecord } from "@/hooks/useDowntime";
import { useWorkOrders } from "@/hooks/useWorkOrders";
import { useMachines, useLines } from "@/hooks/useMachines";
import { useRecentMachineEvents } from "@/hooks/useMachineEvents";
import { type RiskLevel } from "@/hooks/usePredictiveAlerts";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  format, differenceInMinutes, startOfDay, endOfDay,
} from "date-fns";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LineChart, Line } from "recharts";
import { useNavigate } from "react-router-dom";
import { reconcileMinutes, unionMs, type Interval } from "@/lib/downtimeReconcile";
import { isNoPlannedShift } from "@/lib/downtimeBuckets";
import { filterWOsByRange, buildMachineHistory, buildMachineRisks } from "@/lib/downtimeReliability";
import { mapWoToStop } from "@/lib/ragDowntime";
import { formatMinutes } from "@/lib/formatDuration";

const CATEGORIES = ["Mechanical", "Electrical", "Machine", "Maintenance", "Filler", "Other"] as const;
const LINES = ["Line 1", "Line 2", "Line 3", "Line 4", "Line 5"] as const;

const riskBadge: Record<RiskLevel, { label: string; className: string }> = {
  HIGH: { label: "HIGH", className: "bg-red-100 text-red-800 border-red-200" },
  MEDIUM: { label: "MEDIUM", className: "bg-amber-100 text-amber-800 border-amber-200" },
  LOW: { label: "LOW", className: "bg-green-100 text-green-800 border-green-200" },
};

type ShiftFilter = "all" | "Day" | "Night";

/* ────────────────────────── Heatmap helpers (moved from DowntimeHeatmapPage) ───────────────────────── */

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const SHIFTS = ["Day", "Night"] as const;
type Shift = (typeof SHIFTS)[number];

interface Cell { minutes: number; count: number }

function shiftOf(hour: number): Shift {
  return hour >= 6 && hour < 18 ? "Day" : "Night";
}

function londonAllParts(at: Date) {
  const dtf = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(
    dtf.formatToParts(at).filter((x) => x.type !== "literal").map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  return {
    year: +p.year, month: +p.month, day: +p.day,
    hour: +p.hour === 24 ? 0 : +p.hour,
    minute: +p.minute, second: +p.second,
  };
}

function londonOffsetMinutes(at: Date): number {
  const p = londonAllParts(at);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUTC - at.getTime()) / 60000);
}

function londonWallToUtc(y: number, mo: number, d: number, h: number): number {
  const naive = Date.UTC(y, mo - 1, d, h, 0, 0);
  const off = londonOffsetMinutes(new Date(naive));
  return naive - off * 60000;
}

function unionMinutes(intervals: Interval[]): number {
  const ms = unionMs(intervals);
  if (ms <= 0) return 0;
  return Math.max(1, Math.round(ms / 60_000));
}

function nextShiftBoundary(t: number): number {
  const p = londonAllParts(new Date(t));
  if (p.hour < 6) return londonWallToUtc(p.year, p.month, p.day, 6);
  if (p.hour < 18) return londonWallToUtc(p.year, p.month, p.day, 18);
  return londonWallToUtc(p.year, p.month, p.day + 1, 6);
}

function cellColor(minutes: number, max: number): string {
  if (minutes <= 0) return "bg-background";
  const pct = max > 0 ? minutes / max : 0;
  if (pct < 0.15) return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
  if (pct < 0.35) return "bg-amber-400/25 text-amber-800 dark:text-amber-200";
  if (pct < 0.65) return "bg-orange-500/40 text-orange-900 dark:text-orange-100";
  return "bg-red-600/70 text-white";
}

interface HeatmapSectionProps {
  records: DowntimeRecord[] | undefined;
  isLoading: boolean;
  fromMs: number;
  toMs: number;
  lineFilter: string; // "all" or line name
  shiftFilter: ShiftFilter;
}

function HeatmapSection({ records, isLoading, fromMs, toMs, lineFilter, shiftFilter }: HeatmapSectionProps) {
  const { matrix, lines, lineTotals, dayShiftTotals, insights, grandMax } = useMemo(() => {
    const perLineIntervals = new Map<string, Map<string, Interval[]>>();
    const perLineCounts = new Map<string, Map<string, number>>();
    const lineAllIntervals = new Map<string, Interval[]>();

    for (const r of records ?? []) {
      if (!r.started_at) continue;
      const line = r.line || "—";
      if (lineFilter !== "all" && line !== lineFilter) continue;
      const start = new Date(r.started_at).getTime();
      const end = r.ended_at ? new Date(r.ended_at).getTime() : Date.now();
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
      if (end <= fromMs || start >= toMs) continue;
      const clampedStart = Math.max(start, fromMs);
      const clampedEnd = Math.min(end, toMs);
      if (clampedEnd <= clampedStart) continue;

      const li = perLineIntervals.get(line) ?? new Map<string, Interval[]>();
      perLineIntervals.set(line, li);
      const lc = perLineCounts.get(line) ?? new Map<string, number>();
      perLineCounts.set(line, lc);

      const allIvs = lineAllIntervals.get(line) ?? [];
      lineAllIntervals.set(line, allIvs);

      let cursor = clampedStart;
      while (cursor < clampedEnd) {
        const boundary = Math.min(nextShiftBoundary(cursor), clampedEnd);
        if (boundary > cursor) {
          const parts = londonAllParts(new Date(cursor));
          const jsWd = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
          const dayIdx = (jsWd + 6) % 7;
          const shift = shiftOf(parts.hour);
          if (shiftFilter === "all" || shift === shiftFilter) {
            const key = `${dayIdx}-${shift}`;
            const ivs = li.get(key) ?? [];
            ivs.push([cursor, boundary]);
            li.set(key, ivs);
            allIvs.push([cursor, boundary]);
          }
        }
        cursor = boundary;
      }

      const sp = londonAllParts(new Date(clampedStart));
      const sJsWd = new Date(Date.UTC(sp.year, sp.month - 1, sp.day)).getUTCDay();
      const startShift = shiftOf(sp.hour);
      if (shiftFilter === "all" || startShift === shiftFilter) {
        const startKey = `${(sJsWd + 6) % 7}-${startShift}`;
        lc.set(startKey, (lc.get(startKey) ?? 0) + 1);
      }
    }

    const perLine = new Map<string, Map<string, Cell>>();
    const dayShiftTotals = new Map<string, Cell>();
    const lineTotals = new Map<string, Cell>();
    let grandMax = 0;

    perLineIntervals.forEach((buckets, line) => {
      const cells = new Map<string, Cell>();
      const counts = perLineCounts.get(line);
      buckets.forEach((ivs, key) => {
        const minutes = unionMinutes(ivs);
        const count = counts?.get(key) ?? 0;
        cells.set(key, { minutes, count });
        if (minutes > grandMax) grandMax = minutes;
        const dst = dayShiftTotals.get(key) ?? { minutes: 0, count: 0 };
        dst.minutes += minutes;
        dst.count += count;
        dayShiftTotals.set(key, dst);
      });
      perLine.set(line, cells);
      const totalMin = unionMinutes(lineAllIntervals.get(line) ?? []);
      const totalCount = Array.from(counts?.values() ?? []).reduce((a, b) => a + b, 0);
      lineTotals.set(line, { minutes: totalMin, count: totalCount });
    });

    const lines = Array.from(perLine.keys()).sort((a, b) => {
      const ma = /line\s*(\d+)/i.exec(a)?.[1];
      const mb = /line\s*(\d+)/i.exec(b)?.[1];
      if (ma && mb) return Number(ma) - Number(mb);
      return a.localeCompare(b);
    });

    const insights: string[] = [];
    for (const line of lines) {
      const lm = perLine.get(line)!;
      const total = lineTotals.get(line)?.minutes ?? 0;
      if (total < 60) continue;
      let worst: { key: string; minutes: number } | null = null;
      lm.forEach((cell, key) => {
        if (!worst || cell.minutes > worst.minutes) worst = { key, minutes: cell.minutes };
      });
      if (worst && worst.minutes / total >= 0.35) {
        const [d, s] = worst.key.split("-");
        const dayName = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][Number(d)];
        const pmDay = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][Number(d)];
        insights.push(
          `${dayName} ${s} shift concentrates ${Math.round((worst.minutes / total) * 100)}% of ${line}'s downtime (${formatMinutes(worst.minutes)}). Consider scheduling PM on ${pmDay} ${s === "Day" ? "night" : "day"}.`,
        );
      }
    }

    return { matrix: perLine, lines, lineTotals, dayShiftTotals, insights, grandMax };
  }, [records, fromMs, toMs, lineFilter, shiftFilter]);

  const visibleShifts = (shiftFilter === "all" ? SHIFTS : [shiftFilter]) as readonly Shift[];

  if (isLoading) return <Skeleton className="h-96" />;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Pattern Matrix</CardTitle>
          <CardDescription>
            Each cell shows total downtime and number of events. Darker = worse. Europe/London time.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-xs border-separate border-spacing-1 min-w-[760px]">
            <thead>
              <tr>
                <th className="text-left p-2 sticky left-0 bg-card">Line</th>
                {DAYS.map((d) => (
                  <th key={d} colSpan={visibleShifts.length} className="text-center p-1 font-semibold">{d}</th>
                ))}
                <th className="text-right p-2">Total</th>
              </tr>
              <tr className="text-[10px] text-muted-foreground">
                <th />
                {DAYS.flatMap((d) => visibleShifts.map((s) => (
                  <th key={`${d}-${s}`} className="font-normal">{s[0]}</th>
                )))}
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 && (
                <tr>
                  <td colSpan={2 + DAYS.length * visibleShifts.length} className="p-8 text-center text-muted-foreground">
                    No downtime recorded in the selected range.
                  </td>
                </tr>
              )}
              {lines.map((line) => {
                const lm = matrix.get(line)!;
                const total = lineTotals.get(line)?.minutes ?? 0;
                return (
                  <tr key={line}>
                    <td className="p-2 font-medium sticky left-0 bg-card">{line}</td>
                    {DAYS.map((_, di) =>
                      visibleShifts.map((s) => {
                        const c = lm.get(`${di}-${s}`) ?? { minutes: 0, count: 0 };
                        return (
                          <td
                            key={`${line}-${di}-${s}`}
                            className={`text-center rounded ${cellColor(c.minutes, grandMax)}`}
                            title={`${line} • ${DAYS[di]} ${s}: ${formatMinutes(c.minutes)} (${c.count} events)`}
                          >
                            <div className="px-1 py-1 leading-tight">
                              <div className="font-semibold tabular-nums">
                                {c.minutes > 0 ? formatMinutes(c.minutes) : "—"}
                              </div>
                              {c.count > 0 && <div className="text-[10px] opacity-80">{c.count}×</div>}
                            </div>
                          </td>
                        );
                      }),
                    )}
                    <td className="p-2 text-right font-semibold tabular-nums">{formatMinutes(total)}</td>
                  </tr>
                );
              })}
            </tbody>
            {lines.length > 0 && (
              <tfoot>
                <tr className="border-t">
                  <td className="p-2 font-semibold sticky left-0 bg-card">Totals</td>
                  {DAYS.map((_, di) =>
                    visibleShifts.map((s) => {
                      const c = dayShiftTotals.get(`${di}-${s}`) ?? { minutes: 0, count: 0 };
                      return (
                        <td key={`tot-${di}-${s}`} className="text-center p-1 font-semibold tabular-nums text-muted-foreground">
                          {c.minutes > 0 ? formatMinutes(c.minutes) : "—"}
                        </td>
                      );
                    }),
                  )}
                  <td className="p-2 text-right font-bold tabular-nums">
                    {(() => {
                      let g = 0;
                      for (const c of dayShiftTotals.values()) g += c.minutes;
                      return g > 0 ? formatMinutes(g) : "—";
                    })()}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-amber-500" />
            Auto Insights
          </CardTitle>
          <CardDescription>Suggested PM windows based on recurring downtime concentration.</CardDescription>
        </CardHeader>
        <CardContent>
          {insights.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No strong day/shift concentration detected. Downtime is distributed evenly.
            </p>
          ) : (
            <ul className="space-y-2">
              {insights.map((msg, i) => (
                <li key={i} className="text-sm rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                  {msg}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ────────────────────────────── Page ────────────────────────────── */

export default function DowntimePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data: records, isLoading } = useDowntime();
  const { data: workOrders } = useWorkOrders({ statusIn: ["open", "in_progress", "received", "arrived"] as any });
  const { data: allWOs } = useWorkOrders();
  const { data: machines } = useMachines();
  const { data: linesData } = useLines();
  const { data: machineEvents } = useRecentMachineEvents();
  const createDowntime = useCreateDowntime();
  const updateDowntime = useUpdateDowntime();
  const deleteDowntime = useDeleteDowntime();

  const [activeTab, setActiveTab] = useState<"overview" | "records" | "heatmap">("overview");
  const [showCreate, setShowCreate] = useState(false);
  const [editRecord, setEditRecord] = useState<DowntimeRecord | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Shared page-level filters (apply across ALL tabs)
  const [filterLine, setFilterLine] = useState("all");
  const [filterShift, setFilterShift] = useState<ShiftFilter>("all");
  const [startDate, setStartDate] = useState<Date>(startOfDay(new Date()));
  const [endDate, setEndDate] = useState<Date>(new Date());
  const [datePreset, setDatePreset] = useState<DateRangePreset>("today");

  // Records-tab-specific sub-filters
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");

  // Form state
  const [formLine, setFormLine] = useState("");
  const [formMachine, setFormMachine] = useState("");
  const [formCategory, setFormCategory] = useState("");
  const [formReason, setFormReason] = useState("");
  const [formStartedAt, setFormStartedAt] = useState("");
  const [formEndedAt, setFormEndedAt] = useState("");
  const [formWOId, setFormWOId] = useState("");
  const [formNotes, setFormNotes] = useState("");

  const resetForm = () => {
    setFormLine(""); setFormMachine(""); setFormCategory(""); setFormReason("");
    setFormStartedAt(""); setFormEndedAt(""); setFormWOId(""); setFormNotes("");
  };

  const openCreate = () => { resetForm(); setShowCreate(true); };

  const openEdit = (r: DowntimeRecord) => {
    setEditRecord(r);
    setFormLine(r.line); setFormMachine(r.machine || ""); setFormCategory(r.category);
    setFormReason(r.reason); setFormStartedAt(r.started_at.slice(0, 16));
    setFormEndedAt(r.ended_at?.slice(0, 16) || ""); setFormWOId(r.work_order_id || "");
    setFormNotes(r.notes || "");
  };

  const handleSubmit = async (isEdit: boolean) => {
    const payload: any = {
      line: formLine, machine: formMachine || null, category: formCategory,
      reason: formReason, started_at: new Date(formStartedAt).toISOString(),
      ended_at: formEndedAt ? new Date(formEndedAt).toISOString() : null,
      work_order_id: (formWOId && formWOId !== "none") ? formWOId : null, notes: formNotes || null,
      reported_by: user?.id || null,
    };
    try {
      if (isEdit && editRecord) {
        await updateDowntime.mutateAsync({ id: editRecord.id, ...payload });
        toast({ title: "Downtime updated" });
        setEditRecord(null);
      } else {
        await createDowntime.mutateAsync(payload);
        toast({ title: "Downtime registered" });
        setShowCreate(false);
      }
      resetForm();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleResolve = async (id: string) => {
    try {
      await updateDowntime.mutateAsync({ id, ended_at: new Date().toISOString() });
      toast({ title: "Downtime resolved" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteDowntime.mutateAsync(deleteId);
      toast({ title: "Downtime deleted" });
      setDeleteId(null);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const woStops = useMemo(() => {
    return (allWOs || [])
      .map((w: any) => {
        const mapped = mapWoToStop(w);
        if (!mapped) return null;
        return {
          id: `wo-${w.id}`,
          line: mapped.line || "—",
          machine: w.machine || null,
          category: "Machine",
          reason: w.description || "Line stopped (WO)",
          started_at: mapped.start as string,
          ended_at: (mapped.end as string) || null,
          notes: w.wo_number ? `WO #${w.wo_number}` : null,
          work_order_id: w.id,
          reported_by: w.line_stopped_by || null,
          source: "wo_event" as const,
        };
      })
      .filter(Boolean) as any[];
  }, [allWOs]);

  const unifiedRecords = useMemo(() => {
    const base = (records || []).map((r: any) => ({ ...r }));
    const existingWoIds = new Set(
      base.filter((r) => r.work_order_id).map((r) => r.work_order_id),
    );
    const extras = woStops.filter((w) => !existingWoIds.has(w.work_order_id));
    return [...base, ...extras];
  }, [records, woStops]);

  // Apply shared page filters (line + shift) to unifiedRecords
  const isInShift = (iso: string): boolean => {
    if (filterShift === "all") return true;
    const p = londonAllParts(new Date(iso));
    return shiftOf(p.hour) === filterShift;
  };

  const sharedFiltered = useMemo(() => {
    return unifiedRecords.filter((r) => {
      if (filterLine !== "all" && r.line !== filterLine) return false;
      if (!isInShift(r.started_at)) return false;
      return true;
    });
  }, [unifiedRecords, filterLine, filterShift]);

  const kpis = useMemo(() => {
    const rangeStartMs = startOfDay(startDate).getTime();
    const rangeEndMs = Math.min(endOfDay(endDate).getTime(), Date.now());
    const nowMs = Date.now();

    // Exclude "No Planned Shift" periods so downtime totals match RAG Weekly.
    const eligible = sharedFiltered.filter(
      (r) => !isNoPlannedShift(r.reason, r.category),
    );

    const totalRange = reconcileMinutes(
      eligible.map((r) => ({ start: r.started_at, end: r.ended_at })),
      rangeStartMs,
      rangeEndMs,
      nowMs,
    );

    const active = eligible.filter(r => !r.ended_at).length;

    const inRange = eligible.filter(r => {
      const t = new Date(r.started_at).getTime();
      return t >= rangeStartMs && t <= rangeEndMs && r.ended_at;
    });
    const avgDuration = inRange.length
      ? Math.round(inRange.reduce((s, r) => s + differenceInMinutes(new Date(r.ended_at!), new Date(r.started_at)), 0) / inRange.length)
      : 0;

    const rangeRecords = eligible.filter(r => {
      const t = new Date(r.started_at).getTime();
      return t >= rangeStartMs && t <= rangeEndMs;
    });
    const lineCount: Record<string, number> = {};
    rangeRecords.forEach(r => { lineCount[r.line] = (lineCount[r.line] || 0) + 1; });
    const mostAffected = Object.entries(lineCount).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";

    return { totalRange, active, avgDuration, mostAffected };
  }, [sharedFiltered, startDate, endDate]);

  const filteredRecords = useMemo(() => {
    const from = startOfDay(startDate).getTime();
    const to = endOfDay(endDate).getTime();
    return sharedFiltered.filter(r => {
      const t = new Date(r.started_at).getTime();
      if (t < from || t > to) return false;
      if (filterCategory !== "all" && r.category !== filterCategory) return false;
      if (filterStatus === "active" && r.ended_at) return false;
      if (filterStatus === "resolved" && !r.ended_at) return false;
      return true;
    });
  }, [sharedFiltered, filterCategory, filterStatus, startDate, endDate]);

  const getDuration = (r: DowntimeRecord) => {
    const end = r.ended_at ? new Date(r.ended_at) : new Date();
    const mins = differenceInMinutes(end, new Date(r.started_at));
    if (mins < 60) return `${mins}min`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  };

  // Reliability (WO-based), respecting shared line filter
  const filteredWOs = useMemo(() => {
    const inRange = filterWOsByRange(allWOs, startDate, endDate);
    return filterLine === "all"
      ? inRange
      : inRange.filter((w: any) => (w.line_at_time || w.line) === filterLine);
  }, [allWOs, startDate, endDate, filterLine]);

  const machineHistory = useMemo(() => buildMachineHistory(filteredWOs), [filteredWOs]);
  const filteredRisks = useMemo(() => buildMachineRisks(filteredWOs), [filteredWOs]);

  const avgMTTR = useMemo(() => {
    const finished = filteredWOs.filter((w) => w.started_at && w.finished_at);
    if (!finished.length) return 0;
    const total = finished.reduce((sum, w) => sum + differenceInMinutes(new Date(w.finished_at!), new Date(w.started_at!)), 0);
    return Math.round(total / finished.length);
  }, [filteredWOs]);

  const avgMTBF = useMemo(() => {
    const vals = filteredRisks.filter((r) => r.mtbfHours !== null).map((r) => r.mtbfHours!);
    if (!vals.length) return 0;
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  }, [filteredRisks]);

  const topProblemMachines = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredWOs.forEach((w) => { counts[w.machine] = (counts[w.machine] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([name, count]) => ({ name: name.length > 15 ? name.slice(0, 15) + "…" : name, fullName: name, count }));
  }, [filteredWOs]);

  const failureTrend = useMemo(() => {
    const dayMap: Record<string, number> = {};
    filteredWOs.forEach((w) => {
      const day = format(new Date(w.created_at), "MM/dd");
      dayMap[day] = (dayMap[day] || 0) + 1;
    });
    return Object.entries(dayMap).map(([date, count]) => ({ date, count }));
  }, [filteredWOs]);

  const getEventsForMachine = (machineName: string) => {
    if (!machineEvents || !machines) return [];
    const m = machines.find((x) => x.name === machineName);
    if (!m) return [];
    return machineEvents.filter((e) => e.machine_id === m.id).slice(0, 10);
  };

  const lineOptions = useMemo(() => {
    const fromDb = (linesData ?? []).map((l: any) => l.name).filter(Boolean);
    return fromDb.length > 0 ? fromDb : [...LINES];
  }, [linesData]);

  const machineOptions = useMemo(() => {
    if (!machines) return [];
    if (!formLine) return machines.map((m: any) => m.name).filter(Boolean);
    return machines
      .filter((m: any) => {
        const ml = m.current_line || m.fixed_line || m.line || "";
        return ml === formLine;
      })
      .map((m: any) => m.name)
      .filter(Boolean);
  }, [machines, formLine]);

  const formFieldsJsx = (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Line *</Label>
          <Select value={formLine || undefined} onValueChange={(v) => { setFormLine(v); setFormMachine(""); }}>
            <SelectTrigger><SelectValue placeholder="Select line" /></SelectTrigger>
            <SelectContent>
              {lineOptions.map((l) => (
                <SelectItem key={l} value={l}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Machine</Label>
          <Select value={formMachine || undefined} onValueChange={setFormMachine} disabled={machineOptions.length === 0}>
            <SelectTrigger><SelectValue placeholder={machineOptions.length === 0 ? "Select line first" : "Select machine"} /></SelectTrigger>
            <SelectContent>
              {machineOptions.map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Category *</Label>
          <Select value={formCategory || undefined} onValueChange={setFormCategory}>
            <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Reason *</Label>
          <Input value={formReason} onChange={e => setFormReason(e.target.value)} required />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Start Time *</Label>
          <Input type="datetime-local" value={formStartedAt} onChange={e => setFormStartedAt(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>End Time</Label>
          <Input type="datetime-local" value={formEndedAt} onChange={e => setFormEndedAt(e.target.value)} />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Link to Work Order</Label>
        <Select value={formWOId || undefined} onValueChange={setFormWOId}>
          <SelectTrigger><SelectValue placeholder="" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None</SelectItem>
            {workOrders?.map(wo => (
              <SelectItem key={wo.id} value={wo.id}>WO-{wo.wo_number} — {wo.machine}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Notes</Label>
        <Textarea value={formNotes} onChange={e => setFormNotes(e.target.value)} rows={2} />
      </div>
    </div>
  );

  const rangeLabel = `${format(startDate, "yyyy-MM-dd")}_to_${format(endDate, "yyyy-MM-dd")}`;

  const buildExportRows = () =>
    filteredRecords.map((r) => ({
      Line: r.line || "",
      Machine: r.machine || "",
      Category: r.category || "",
      Reason: r.reason || "",
      Start: r.started_at ? format(new Date(r.started_at), "yyyy-MM-dd HH:mm") : "",
      End: r.ended_at ? format(new Date(r.ended_at), "yyyy-MM-dd HH:mm") : "Ongoing",
      Duration: getDuration(r),
      Notes: r.notes || "",
    }));

  const handleExportPdf = () => {
    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(14);
    doc.text("Downtime & Reliability Report", 14, 14);
    doc.setFontSize(10);
    doc.text(
      `Range: ${format(startDate, "PP")} — ${format(endDate, "PP")}   |   Records: ${filteredRecords.length}   |   Avg MTTR: ${avgMTTR}m   |   Avg MTBF: ${avgMTBF}h`,
      14, 21,
    );
    const rows = buildExportRows();
    autoTable(doc, {
      startY: 26,
      head: [["Line", "Machine", "Category", "Reason", "Start", "End", "Duration", "Notes"]],
      body: rows.map((r) => [r.Line, r.Machine, r.Category, r.Reason, r.Start, r.End, r.Duration, r.Notes]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [234, 88, 12] },
    });
    if (filteredRisks.length) {
      autoTable(doc, {
        head: [["Machine", "Failures", "MTBF (h)", "MTTR (m)", "Risk"]],
        body: filteredRisks.map((r: any) => [r.machine, r.count, r.mtbfHours ?? "—", r.mttrMinutes ?? "—", r.risk]),
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [59, 130, 246] },
      });
    }
    doc.save(`downtime-reliability_${rangeLabel}.pdf`);
  };

  const handleExportXlsx = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(buildExportRows()), "Downtime Records");
    if (filteredRisks.length) {
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(
          filteredRisks.map((r: any) => ({
            Machine: r.machine,
            Failures: r.count,
            "MTBF (h)": r.mtbfHours ?? "",
            "MTTR (m)": r.mttrMinutes ?? "",
            Risk: r.risk,
          })),
        ),
        "Machine Risk",
      );
    }
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet([
        { Metric: "Range Start", Value: format(startDate, "yyyy-MM-dd") },
        { Metric: "Range End", Value: format(endDate, "yyyy-MM-dd") },
        { Metric: "Records", Value: filteredRecords.length },
        { Metric: "Avg MTTR (min)", Value: avgMTTR },
        { Metric: "Avg MTBF (h)", Value: avgMTBF },
      ]),
      "Summary",
    );
    XLSX.writeFile(wb, `downtime-reliability_${rangeLabel}.xlsx`);
  };

  const printRootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const expandedTriggers: HTMLElement[] = [];
    const beforePrint = () => {
      const root = printRootRef.current;
      if (!root) return;
      const triggers = root.querySelectorAll<HTMLElement>(
        '[data-state="closed"][aria-controls], button[aria-expanded="false"][data-state="closed"]',
      );
      triggers.forEach((t) => {
        try { t.click(); expandedTriggers.push(t); } catch { /* noop */ }
      });
    };
    const afterPrint = () => {
      expandedTriggers.splice(0).forEach((t) => {
        try { t.click(); } catch { /* noop */ }
      });
    };
    window.addEventListener("beforeprint", beforePrint);
    window.addEventListener("afterprint", afterPrint);
    return () => {
      window.removeEventListener("beforeprint", beforePrint);
      window.removeEventListener("afterprint", afterPrint);
    };
  }, []);

  const handlePrint = () => {
    setTimeout(() => window.print(), 50);
  };

  const printGeneratedAt = format(new Date(), "yyyy-MM-dd HH:mm");
  const printRangeLabel = `${format(startDate, "PP")} — ${format(endDate, "PP")}`;

  const fromMs = startOfDay(startDate).getTime();
  const toMs = endOfDay(endDate).getTime();

  return (
    <DashboardLayout>
      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 12mm; }
          html, body { background: #fff !important; }
          body * { visibility: hidden !important; }
          .downtime-print-root, .downtime-print-root * { visibility: visible !important; }
          .downtime-print-root {
            position: absolute; left: 0; top: 0; width: 100%;
            color: #000 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .downtime-print-root .print-only { display: block !important; }
          .downtime-print-root .no-print { display: none !important; }
          .downtime-print-root table { width: 100% !important; border-collapse: collapse !important; font-size: 10px !important; }
          .downtime-print-root thead { display: table-header-group !important; }
          .downtime-print-root tfoot { display: table-footer-group !important; }
          .downtime-print-root tr { page-break-inside: avoid !important; break-inside: avoid !important; }
          .downtime-print-root th, .downtime-print-root td {
            border: 1px solid #999 !important; padding: 4px 6px !important;
            color: #000 !important; background: #fff !important;
          }
          .downtime-print-root th { background: #f0f0f0 !important; font-weight: 700 !important; }
          .downtime-print-root .print-page-break { page-break-before: always !important; break-before: page !important; }
          .downtime-print-root [hidden] { display: revert !important; }
          .downtime-print-root [data-state="closed"] { display: revert !important; }
          .downtime-print-root .recharts-wrapper { page-break-inside: avoid !important; }
          .downtime-print-root [role="tabpanel"] { display: block !important; }
          .downtime-print-footer {
            position: fixed; bottom: 4mm; left: 0; right: 0;
            font-size: 9px; color: #555; text-align: center;
            border-top: 1px solid #ccc; padding-top: 2px;
          }
        }
        .print-only { display: none; }
      `}</style>
      <div className="downtime-print-root" ref={printRootRef}>
        <div className="space-y-6">
          {/* Print-only header */}
          <div className="print-only" style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "2px solid #000", paddingBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <img src="/favicon.png" alt="AN" style={{ height: 36, width: 36 }} />
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>Downtime & Reliability</div>
                  <div style={{ fontSize: 10, color: "#333" }}>Range: {printRangeLabel}</div>
                </div>
              </div>
              <div style={{ fontSize: 10, textAlign: "right", color: "#333" }}>
                <div>Line: {filterLine === "all" ? "All" : filterLine}</div>
                <div>Shift: {filterShift === "all" ? "All" : filterShift}</div>
                <div>Generated: {printGeneratedAt}</div>
              </div>
            </div>
          </div>

          <PageHeader
            title="Downtime & Reliability"
            description="Production stoppages, MTBF/MTTR & machine risk intelligence"
            icon={<Clock className="h-5 w-5" />}
            actions={
              <div className="flex flex-wrap items-center gap-2 justify-end">
                <DateRangeFilter
                  value={{ from: startDate, to: endDate }}
                  preset={datePreset}
                  storageKey="downtime-page"
                  onChange={(range, preset) => {
                    setDatePreset(preset);
                    const r = preset === "all" ? getPresetRange("30d") : range;
                    if (r.from) setStartDate(startOfDay(r.from));
                    if (r.to) setEndDate(endOfDay(r.to));
                  }}
                />
                <Select value={filterLine} onValueChange={setFilterLine}>
                  <SelectTrigger className="w-[140px]"><SelectValue placeholder="Line" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Lines</SelectItem>
                    {lineOptions.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={filterShift} onValueChange={(v) => setFilterShift(v as ShiftFilter)}>
                  <SelectTrigger className="w-[130px]"><SelectValue placeholder="Shift" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Shifts</SelectItem>
                    <SelectItem value="Day">Day (06–18)</SelectItem>
                    <SelectItem value="Night">Night (18–06)</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-1 rounded-md border bg-muted/30 p-1">
                  <Button size="sm" variant="ghost" onClick={handleExportPdf} title="Export PDF">
                    <FileText className="h-4 w-4 mr-1.5" /> PDF
                  </Button>
                  <Button size="sm" variant="ghost" onClick={handleExportXlsx} title="Export Excel">
                    <FileSpreadsheet className="h-4 w-4 mr-1.5" /> Excel
                  </Button>
                  <Button size="sm" variant="ghost" onClick={handlePrint} title="Print">
                    <Printer className="h-4 w-4 mr-1.5" /> Print
                  </Button>
                </div>
                <Button className="bg-orange-600 hover:bg-orange-700 text-white" onClick={openCreate}>
                  <Plus className="h-4 w-4 mr-2" /> Register Downtime
                </Button>
              </div>
            }
          />

          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
            <TabsList className="grid w-full grid-cols-3 md:w-auto md:inline-flex">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="records">Records</TabsTrigger>
              <TabsTrigger value="heatmap">Heatmap</TabsTrigger>
            </TabsList>

            {/* ─────────── OVERVIEW TAB ─────────── */}
            <TabsContent value="overview" className="space-y-6 mt-6">
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Downtime (Selected Range)</CardTitle>
                    <Clock className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{kpis.totalRange < 60 ? `${kpis.totalRange}min` : `${Math.floor(kpis.totalRange / 60)}h ${kpis.totalRange % 60}m`}</div>
                  </CardContent>
                </Card>
                <Card className={kpis.active > 0 ? "border-destructive" : ""}>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Active Stoppages</CardTitle>
                    <AlertTriangle className={`h-4 w-4 ${kpis.active > 0 ? "text-destructive" : "text-muted-foreground"}`} />
                  </CardHeader>
                  <CardContent>
                    <div className={`text-2xl font-bold ${kpis.active > 0 ? "text-destructive" : ""}`}>{kpis.active}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Avg Duration (Period)</CardTitle>
                    <Activity className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{kpis.avgDuration}min</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Most Affected Line (Period)</CardTitle>
                    <TrendingUp className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{kpis.mostAffected}</div>
                  </CardContent>
                </Card>
              </div>

              <ShiftBreakdownCard date={endDate} onDateChange={(d) => { setEndDate(d); setDatePreset("custom"); }} />

              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                  <CardContent className="p-4">
                    <div className="text-2xl font-bold">{avgMTTR} min</div>
                    <p className="text-xs text-muted-foreground">Avg MTTR (Period)</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="text-2xl font-bold">{avgMTBF} hrs</div>
                    <p className="text-xs text-muted-foreground">Avg MTBF (Period)</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="text-2xl font-bold">{filteredWOs.length}</div>
                    <p className="text-xs text-muted-foreground">WOs (Period)</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="text-2xl font-bold">{filteredRisks.filter((r) => r.risk === "HIGH").length}</div>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 text-red-500" />High Risk Machines
                    </p>
                  </CardContent>
                </Card>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader><CardTitle className="text-sm">Top Problem Machines</CardTitle></CardHeader>
                  <CardContent className="h-[250px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={topProblemMachines} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" />
                        <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11 }} />
                        <Tooltip formatter={(v: number) => [v, "WOs"]} />
                        <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader><CardTitle className="text-sm flex items-center gap-1"><TrendingUp className="h-4 w-4" />Failure Trend</CardTitle></CardHeader>
                  <CardContent className="h-[250px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={failureTrend}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                        <YAxis />
                        <Tooltip />
                        <Line type="monotone" dataKey="count" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* ─────────── RECORDS TAB ─────────── */}
            <TabsContent value="records" className="space-y-6 mt-6">
              <Card>
                <CardHeader>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <CardTitle className="text-base">Downtime Records</CardTitle>
                    <div className="grid grid-cols-2 sm:flex sm:items-center sm:flex-wrap gap-2">
                      <Select value={filterCategory} onValueChange={setFilterCategory}>
                        <SelectTrigger className="w-full sm:w-[160px]"><SelectValue placeholder="Category" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Categories</SelectItem>
                          {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Select value={filterStatus} onValueChange={setFilterStatus}>
                        <SelectTrigger className="w-full sm:w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Status</SelectItem>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="resolved">Resolved</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {isLoading ? (
                    <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                  ) : !filteredRecords.length ? (
                    <div className="text-center py-12">
                      <Clock className="h-12 w-12 mx-auto text-muted-foreground/40 mb-3" />
                      <p className="text-muted-foreground font-medium">No downtime records found</p>
                    </div>
                  ) : (
                    <>
                      <div className="md:hidden space-y-3">
                        {filteredRecords.map(r => {
                          const active = !r.ended_at;
                          return (
                            <div key={r.id} className={`rounded-lg border p-3 space-y-2 ${active ? "border-destructive/50 bg-destructive/5" : "bg-card"}`}>
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                  <p className={`font-semibold truncate ${r.line === "— (line deleted)" ? "italic text-muted-foreground" : ""}`}>{r.line}</p>
                                  <p className="text-xs text-muted-foreground">{r.machine || "—"}</p>
                                </div>
                                {active ? <StatusBadge status="active" /> : <StatusBadge status="resolved" />}
                              </div>
                              <p className="text-sm line-clamp-2">{r.reason}</p>
                              <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <Badge variant="outline">{r.category}</Badge>
                                <span>{format(new Date(r.started_at), "dd/MM HH:mm")}</span>
                                <span className="font-mono">{getDuration(r)}</span>
                              </div>
                              {r.source === "wo_event" ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-11 w-full touch-manipulation"
                                  onClick={() => r.work_order_id && navigate(`/dashboard/wo/${r.work_order_id}`)}
                                  disabled={!r.work_order_id}
                                >
                                  Open WO
                                </Button>
                              ) : (
                                <div className="flex gap-2">
                                  <Button size="sm" variant="outline" className="h-10 flex-1 touch-manipulation" onClick={() => openEdit(r)}>
                                    <Pencil className="h-4 w-4 mr-1" /> Edit
                                  </Button>
                                  {active && (
                                    <Button size="sm" variant="outline" className="h-10 flex-1 text-green-600 touch-manipulation" onClick={() => handleResolve(r.id)}>
                                      <CheckCircle className="h-4 w-4 mr-1" /> Resolve
                                    </Button>
                                  )}
                                  <Button size="sm" variant="destructive" className="h-10 touch-manipulation" onClick={() => setDeleteId(r.id)}>
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      <Table className="hidden md:table">
                        <TableHeader>
                          <TableRow>
                            <TableHead>Line</TableHead>
                            <TableHead>Machine</TableHead>
                            <TableHead>Category</TableHead>
                            <TableHead>Reason</TableHead>
                            <TableHead>Started</TableHead>
                            <TableHead>Duration</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredRecords.map(r => (
                            <TableRow key={r.id}>
                              <TableCell className={r.line === "— (line deleted)" ? "italic text-muted-foreground" : "font-medium"}>{r.line}</TableCell>
                              <TableCell>{r.machine || "—"}</TableCell>
                              <TableCell><Badge variant="outline">{r.category}</Badge></TableCell>
                              <TableCell className="max-w-[200px] truncate">{r.reason}</TableCell>
                              <TableCell className="text-sm whitespace-nowrap">{format(new Date(r.started_at), "dd/MM HH:mm")}</TableCell>
                              <TableCell className="font-mono text-sm">{getDuration(r)}</TableCell>
                              <TableCell>
                                {r.ended_at ? <StatusBadge status="resolved" /> : <StatusBadge status="active" />}
                              </TableCell>
                              <TableCell>
                                {r.source === "wo_event" ? (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => r.work_order_id && navigate(`/dashboard/wo/${r.work_order_id}`)}
                                    disabled={!r.work_order_id}
                                  >
                                    Open WO
                                  </Button>
                                ) : (
                                  <div className="flex items-center gap-1">
                                    <Button size="icon" variant="ghost" onClick={() => openEdit(r)}><Pencil className="h-4 w-4" /></Button>
                                    {!r.ended_at && (
                                      <Button size="icon" variant="ghost" className="text-green-600" onClick={() => handleResolve(r.id)} title="Mark Resolved">
                                        <CheckCircle className="h-4 w-4" />
                                      </Button>
                                    )}
                                    <Button size="icon" variant="ghost" className="text-destructive" onClick={() => setDeleteId(r.id)}>
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </div>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><History className="h-5 w-5" />Machine Problem History</CardTitle>
                </CardHeader>
                <CardContent>
                  {machineHistory.length === 0 ? (
                    <p className="text-muted-foreground text-center py-4">No problems recorded for this period</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>#</TableHead>
                          <TableHead>Machine</TableHead>
                          <TableHead className="text-center">Failures</TableHead>
                          <TableHead>Top Problem</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {machineHistory.map((m, i) => (
                          <TableRow key={m.machine}>
                            <TableCell className="font-medium text-muted-foreground">{i + 1}</TableCell>
                            <TableCell className="font-medium">{m.machine}</TableCell>
                            <TableCell className="text-center"><Badge variant={m.count >= 5 ? "destructive" : "secondary"}>{m.count}</Badge></TableCell>
                            <TableCell className="text-sm text-muted-foreground truncate max-w-[200px]" title={m.topProblem}>
                              {m.topProblem} {m.topProblemCount > 1 && <span className="text-xs">(×{m.topProblemCount})</span>}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>

              <Card className="print-page-break">
                <CardHeader><CardTitle className="flex items-center gap-2"><Cog className="h-5 w-5" />Machine Risk Assessment</CardTitle></CardHeader>
                <CardContent>
                  {filteredRisks.length === 0 ? (
                    <p className="text-muted-foreground text-center py-4">No data for selected period</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Machine</TableHead>
                          <TableHead>Failures</TableHead>
                          <TableHead>MTBF (hrs)</TableHead>
                          <TableHead>Risk</TableHead>
                          <TableHead>Last Failure</TableHead>
                          <TableHead>Alerts</TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredRisks.map((r) => (
                          <Collapsible key={r.machine} asChild>
                            <>
                              <TableRow>
                                <TableCell className="font-medium">{r.machine}</TableCell>
                                <TableCell>{r.failures30d}</TableCell>
                                <TableCell>{r.mtbfHours ?? "—"}</TableCell>
                                <TableCell><Badge variant="outline" className={riskBadge[r.risk].className}>{riskBadge[r.risk].label}</Badge></TableCell>
                                <TableCell className="text-sm text-muted-foreground">{r.lastFailure ? format(new Date(r.lastFailure), "dd/MM HH:mm") : "—"}</TableCell>
                                <TableCell>
                                  <div className="flex gap-1 flex-wrap">
                                    {r.mtbfWarning && <Badge variant="outline" className="text-xs bg-orange-100 text-orange-800 border-orange-200">MTBF Warning</Badge>}
                                    {r.recentRepairAlert && <Badge variant="outline" className="text-xs bg-blue-100 text-blue-800 border-blue-200">Recent Repair</Badge>}
                                    {r.recurringProblems.length > 0 && <Badge variant="outline" className="text-xs bg-red-100 text-red-800 border-red-200">Recurring</Badge>}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <CollapsibleTrigger asChild>
                                    <Button variant="ghost" size="sm"><ChevronDown className="h-4 w-4" /></Button>
                                  </CollapsibleTrigger>
                                </TableCell>
                              </TableRow>
                              <CollapsibleContent asChild>
                                <TableRow className="bg-muted/30">
                                  <TableCell colSpan={7}>
                                    <div className="p-2 space-y-1">
                                      <p className="text-sm font-medium">Last 10 Events</p>
                                      {getEventsForMachine(r.machine).length === 0 ? (
                                        <p className="text-xs text-muted-foreground">No events recorded yet</p>
                                      ) : (
                                        <div className="space-y-1">
                                          {getEventsForMachine(r.machine).map((ev) => (
                                            <div key={ev.id} className="flex gap-3 text-xs items-center">
                                              <span className="text-muted-foreground w-[90px]">{format(new Date(ev.created_at), "dd/MM HH:mm")}</span>
                                              <Badge variant="secondary" className="text-xs">{ev.event_type}</Badge>
                                              <span className="truncate">{ev.problem_description || "—"}</span>
                                              {ev.engineer_name && <span className="text-muted-foreground">by {ev.engineer_name}</span>}
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                      {r.recurringProblems.length > 0 && (
                                        <div className="mt-2">
                                          <p className="text-xs font-medium text-red-700">Recurring Problems (≥3 in 7 days):</p>
                                          {r.recurringProblems.map((p) => <Badge key={p} variant="outline" className="text-xs mr-1 bg-red-50 text-red-700">{p}</Badge>)}
                                        </div>
                                      )}
                                    </div>
                                  </TableCell>
                                </TableRow>
                              </CollapsibleContent>
                            </>
                          </Collapsible>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* ─────────── HEATMAP TAB ─────────── */}
            <TabsContent value="heatmap" className="mt-6">
              <HeatmapSection
                records={records}
                isLoading={isLoading}
                fromMs={fromMs}
                toMs={toMs}
                lineFilter={filterLine}
                shiftFilter={filterShift}
              />
            </TabsContent>
          </Tabs>

          {/* Create Dialog */}
          <Dialog open={showCreate} onOpenChange={o => { setShowCreate(o); if (!o) resetForm(); }}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Register Downtime</DialogTitle>
                <DialogDescription className="sr-only">Fill in the details to register a new downtime event</DialogDescription>
              </DialogHeader>
              {formFieldsJsx}
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
                <Button onClick={() => handleSubmit(false)} disabled={!formLine || !formCategory || !formReason || !formStartedAt || createDowntime.isPending}>
                  {createDowntime.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Register
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Edit Dialog */}
          <Dialog open={!!editRecord} onOpenChange={o => { if (!o) { setEditRecord(null); resetForm(); } }}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Edit Downtime</DialogTitle>
                <DialogDescription className="sr-only">Edit the details of this downtime record</DialogDescription>
              </DialogHeader>
              {formFieldsJsx}
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditRecord(null)}>Cancel</Button>
                <Button onClick={() => handleSubmit(true)} disabled={!formLine || !formCategory || !formReason || !formStartedAt || updateDowntime.isPending}>
                  {updateDowntime.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Delete Confirmation */}
          <AlertDialog open={!!deleteId} onOpenChange={o => { if (!o) setDeleteId(null); }}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete downtime record?</AlertDialogTitle>
                <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <div className="print-only downtime-print-footer">
            Downtime & Reliability · Generated {printGeneratedAt}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
