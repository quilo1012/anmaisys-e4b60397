import { useMemo, useRef, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KpiCard } from "@/components/reports/KpiCard";
import { ReportPrintHeader } from "@/components/reports/ReportPrintHeader";
import { printElementAsDocument } from "@/lib/printDocument";
import { BackButton } from "@/components/BackButton";
import { Users, Printer, Clock, CalendarDays, TrendingDown, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import {
  useEmployees, useOvertimeEntries, useOvertimePeriods, useShiftPatterns, describeDays,
  useAttendance, worksOn,
} from "@/hooks/useWorkforce";
import { HeadcountBoard, type BoardEmployee } from "@/components/workforce/HeadcountBoard";
import { useRole } from "@/hooks/useRole";
import { useAuth } from "@/contexts/AuthContext";

const fmtHours = (h: number) => `${h > 0 ? "" : ""}${h.toFixed(2).replace(/\.00$/, "")}h`;

export default function WorkforcePage() {
  const { data: employees, isLoading: loadingEmp } = useEmployees();
  const { data: patterns } = useShiftPatterns();
  const { data: periods, isLoading: loadingPer } = useOvertimePeriods();
  const [periodId, setPeriodId] = useState<string | null>(null);
  const activePeriod = periods?.find((p) => p.id === periodId) ?? periods?.[0] ?? null;
  const { data: entries, isLoading: loadingOT } = useOvertimeEntries(activePeriod?.id ?? null);
  const [search, setSearch] = useState("");
  const [boardDate, setBoardDate] = useState(() => new Date());
  const boardDateKey = boardDate.toISOString().slice(0, 10);
  const { data: attendance } = useAttendance(boardDateKey);
  const { can } = useRole();
  const { user } = useAuth();
  const canEdit = can("workforce.manage");
  const [dept, setDept] = useState("__all__");
  const printRef = useRef<HTMLDivElement>(null);

  const patternById = useMemo(
    () => new Map((patterns ?? []).map((p) => [p.id, p])),
    [patterns],
  );

  const rows = useMemo(() => {
    const byEmployee = new Map((entries ?? []).map((e) => [e.employee_id, e]));
    return (employees ?? [])
      .map((e) => ({
        ...e,
        pattern: e.shift_pattern_id ? patternById.get(e.shift_pattern_id) ?? null : null,
        overtime: byEmployee.get(e.id) ?? null,
      }))
      .filter((e) => (dept === "__all__" ? true : (e.department ?? "—") === dept))
      .filter((e) => (search.trim() ? e.full_name.toLowerCase().includes(search.trim().toLowerCase()) : true));
  }, [employees, entries, patternById, dept, search]);

  const kpis = useMemo(() => {
    const withOT = rows.filter((r) => r.overtime);
    const total = withOT.reduce((s, r) => s + Number(r.overtime!.hours), 0);
    const negative = withOT.filter((r) => Number(r.overtime!.hours) < 0);
    return {
      headcount: rows.filter((r) => r.active).length,
      withOT: withOT.length,
      total,
      // Named separately because it is not "less overtime" — it is sickness written
      // off against banked hours, and averaging it into the total hides both.
      negative: negative.length,
      negativeHours: negative.reduce((s, r) => s + Number(r.overtime!.hours), 0),
      unassigned: rows.filter((r) => !r.pattern).length,
    };
  }, [rows]);

  const departments = useMemo(
    () => Array.from(new Set((employees ?? []).map((e) => e.department).filter(Boolean))).sort() as string[],
    [employees],
  );

  const top = useMemo(
    () => rows.filter((r) => r.overtime).sort((a, b) => Number(b.overtime!.hours) - Number(a.overtime!.hours)).slice(0, 5),
    [rows],
  );

  const boardEmployees = useMemo<BoardEmployee[]>(
    () => rows.map((r) => ({ ...r, overtimeHours: r.overtime ? Number(r.overtime.hours) : null })),
    [rows],
  );

  /**
   * Alerts, and only ones the data can actually support.
   *
   * No "over the overtime cap": there is no cap in this data, and inventing 60h
   * would put a red badge against people for crossing a line nobody set.
   */
  const alerts = useMemo(() => {
    const scheduledToday = boardEmployees.filter((e) => e.active && e.pattern && worksOn(e.pattern.days, boardDate));
    const byId = new Map((attendance ?? []).map((a) => [a.employee_id, a]));
    return {
      awayToday: scheduledToday.filter((e) => ["absent", "sick"].includes(byId.get(e.id)?.status ?? "")).length,
      unmarked: scheduledToday.filter((e) => !byId.has(e.id)).length,
      scheduledToday: scheduledToday.length,
      negative: boardEmployees.filter((e) => (e.overtimeHours ?? 0) < 0),
      noPattern: boardEmployees.filter((e) => e.active && !e.pattern),
    };
  }, [boardEmployees, attendance, boardDate]);

  const isLoading = loadingEmp || loadingPer || loadingOT;
  const periodLabel = activePeriod
    ? `${format(new Date(activePeriod.starts_on), "dd/MM/yyyy")} — ${format(new Date(activePeriod.ends_on), "dd/MM/yyyy")}`
    : "No period";

  return (
    <DashboardLayout>
      <div ref={printRef} className="space-y-4 print-content">
        <ReportPrintHeader title="Workforce" periodLabel={periodLabel} />
        <BackButton className="no-print" />

        <PageHeader
          title="Workforce"
          description="People, the days they work, and the overtime they carry"
          icon={<Users className="h-5 w-5" />}
          actions={
            <div className="flex flex-wrap items-center gap-2 no-print">
              <Select value={activePeriod?.id ?? ""} onValueChange={setPeriodId}>
                <SelectTrigger className="w-56"><SelectValue placeholder="Period" /></SelectTrigger>
                <SelectContent>
                  {(periods ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => { const el = printRef.current; if (el) await printElementAsDocument(el, "Workforce", { landscape: true }); }}
              >
                <Printer className="mr-1 h-4 w-4" /> Print
              </Button>
            </div>
          }
        />

        <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
          <KpiCard label="Headcount" icon={<Users className="h-3.5 w-3.5" />} value={kpis.headcount} accent="blue" sublabel="Active people on file" />
          <KpiCard label="Overtime in period" icon={<Clock className="h-3.5 w-3.5" />} value={fmtHours(kpis.total)} accent="purple" sublabel={`${kpis.withOT} with a balance`} />
          <KpiCard
            label="Negative balances"
            icon={<TrendingDown className="h-3.5 w-3.5" />}
            value={kpis.negative}
            accent="warning"
            toneValue
            sublabel={kpis.negative ? `${fmtHours(kpis.negativeHours)} written off to sickness` : "Nobody in deficit"}
          />
          <KpiCard label="Shift assigned" icon={<CalendarDays className="h-3.5 w-3.5" />} value={kpis.headcount - kpis.unassigned} accent="ok" sublabel={kpis.unassigned ? `${kpis.unassigned} still without a pattern` : "Everyone has a pattern"} />
          <KpiCard label="Departments" icon={<Users className="h-3.5 w-3.5" />} value={departments.length} accent="info" sublabel="On the employee list" />
        </div>

        <Card className="break-inside-avoid">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Today on the floor</CardTitle>
                <CardDescription>{format(boardDate, "EEEE, dd/MM/yyyy")}</CardDescription>
              </div>
              <Input
                type="date"
                value={boardDateKey}
                onChange={(e) => e.target.value && setBoardDate(new Date(`${e.target.value}T12:00:00`))}
                className="h-9 w-44 no-print"
              />
            </div>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-4">
            <div className="rounded-lg border p-2">
              <div className="text-2xs uppercase text-muted-foreground">Scheduled</div>
              <div className="font-mono text-xl font-bold">{alerts.scheduledToday}</div>
              <div className="text-2xs text-muted-foreground">Pattern covers this day</div>
            </div>
            <div className="rounded-lg border p-2">
              <div className="text-2xs uppercase text-muted-foreground">Away</div>
              <div className={`font-mono text-xl font-bold ${alerts.awayToday ? "text-destructive-strong" : ""}`}>{alerts.awayToday}</div>
              <div className="text-2xs text-muted-foreground">Marked absent or sick</div>
            </div>
            <div className="rounded-lg border p-2">
              <div className="text-2xs uppercase text-muted-foreground">Not marked</div>
              <div className={`font-mono text-xl font-bold ${alerts.unmarked ? "text-warning-strong" : ""}`}>{alerts.unmarked}</div>
              <div className="text-2xs text-muted-foreground">Nobody has said yet</div>
            </div>
            <div className="rounded-lg border p-2">
              <div className="text-2xs uppercase text-muted-foreground">No shift pattern</div>
              <div className={`font-mono text-xl font-bold ${alerts.noPattern.length ? "text-warning-strong" : ""}`}>{alerts.noPattern.length}</div>
              <div className="text-2xs text-muted-foreground">Days of work unrecorded</div>
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <Skeleton className="h-64" />
        ) : (
          <HeadcountBoard
            employees={boardEmployees}
            attendance={attendance ?? []}
            onDate={boardDate}
            canEdit={canEdit}
            userId={user?.id}
          />
        )}

        {(alerts.negative.length > 0 || alerts.noPattern.length > 0) && (
          <Card className="break-inside-avoid border-amber-500/40">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="h-4 w-4 text-warning-strong" /> Worth a look
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-xs">
              {alerts.negative.length > 0 && (
                <p>
                  <b>{alerts.negative.length}</b> in overtime deficit —{" "}
                  {alerts.negative.map((e) => `${e.full_name} (${e.overtimeHours}h)`).join(", ")}. Sickness
                  written off against banked hours, not hours owed to the factory.
                </p>
              )}
              {alerts.noPattern.length > 0 && (
                <p>
                  <b>{alerts.noPattern.length}</b> without a shift pattern, so the board cannot say whether
                  they are due in: {alerts.noPattern.slice(0, 8).map((e) => e.full_name).join(", ")}
                  {alerts.noPattern.length > 8 ? "…" : ""}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        <Card className="break-inside-avoid">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Top overtime balances</CardTitle>
            <CardDescription>
              A balance, not hours worked: sickness is written off against banked hours, so a negative figure is real.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-5">
            {top.map((r) => (
              <div key={r.id} className="rounded-lg border p-2">
                <div className="truncate text-xs font-semibold">{r.full_name}</div>
                <div className={`font-mono text-lg font-bold ${Number(r.overtime!.hours) < 0 ? "text-destructive-strong" : ""}`}>
                  {fmtHours(Number(r.overtime!.hours))}
                </div>
                <div className="truncate text-2xs text-muted-foreground">{r.department ?? "Department to confirm"}</div>
              </div>
            ))}
            {top.length === 0 && <p className="text-sm text-muted-foreground">No overtime recorded for this period.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">People ({rows.length})</CardTitle>
              <div className="flex flex-wrap gap-2 no-print">
                <Input placeholder="Search name…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 w-48" />
                <Select value={dept} onValueChange={setDept}>
                  <SelectTrigger className="h-9 w-56"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All departments</SelectItem>
                    {departments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {isLoading ? (
              <Skeleton className="h-64" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Works</TableHead>
                    <TableHead className="text-right">Overtime</TableHead>
                    <TableHead>Note</TableHead>
                    <TableHead>Source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Nobody matches these filters</TableCell></TableRow>
                  )}
                  {rows.map((r) => {
                    const h = r.overtime ? Number(r.overtime.hours) : null;
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.full_name}</TableCell>
                        <TableCell className={r.department ? "" : "text-muted-foreground"}>
                          {r.department ?? "to confirm"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {r.pattern ? (
                            <span title={r.pattern.name}>{describeDays(r.pattern.days)}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className={`text-right font-mono tabular-nums ${h != null && h < 0 ? "font-bold text-destructive-strong" : ""}`}>
                          {h == null ? <span className="font-sans text-muted-foreground">—</span> : fmtHours(h)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.overtime?.note ?? ""}</TableCell>
                        <TableCell>
                          {r.source === "import_overtime" && (
                            // Provenance on the row, so an imported guess is never
                            // mistaken for something HR confirmed.
                            <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-2xs text-warning-strong">
                              From overtime sheet
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
