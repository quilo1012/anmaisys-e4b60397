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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KpiCard } from "@/components/reports/KpiCard";
import { ReportPrintHeader } from "@/components/reports/ReportPrintHeader";
import { printElementAsDocument } from "@/lib/printDocument";
import { BackButton } from "@/components/BackButton";
import { Users, Printer, CalendarDays, TrendingDown, AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import {
  useEmployees, useOvertimeEntries, useOvertimePeriods, useShiftPatterns, describeDays,
  useAttendance, worksOn,
} from "@/hooks/useWorkforce";
import { HeadcountBoard, type BoardEmployee } from "@/components/workforce/HeadcountBoard";
import { EmployeeDetailPanel } from "@/components/workforce/EmployeeDetailPanel";
import { MonthlySummary } from "@/components/workforce/MonthlySummary";
import { AddEmployeeDialog } from "@/components/workforce/AddEmployeeDialog";
import { OvertimePanel } from "@/components/workforce/OvertimePanel";
import { useRole } from "@/hooks/useRole";
import { useAuth } from "@/contexts/AuthContext";

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
  const [detailId, setDetailId] = useState<string | null>(null);
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

  // Headcount only. The overtime figures moved to OvertimePanel, which owns the
  // period they belong to.
  const kpis = useMemo(
    () => ({
      headcount: rows.filter((r) => r.active).length,
      unassigned: rows.filter((r) => r.active && !r.pattern).length,
    }),
    [rows],
  );

  const departments = useMemo(
    () => Array.from(new Set((employees ?? []).map((e) => e.department).filter(Boolean))).sort() as string[],
    [employees],
  );

  // Leavers drop off the board and out of the people list, and stay everywhere that
  // looks backwards: the monthly summary still counts the days they worked, and their
  // overtime balance is still theirs. Someone who left in July worked in July.
  const boardEmployees = useMemo<BoardEmployee[]>(
    () => rows.filter((r) => r.active),
    [rows],
  );

  /**
   * The list is who works here. Leavers are kept, not hidden — they are listed under
   * their own heading, closed by default, because a name that is on the list is read
   * as somebody who might be in tomorrow.
   */
  const onTheList = useMemo(() => rows.filter((r) => r.active), [rows]);
  const leavers = useMemo(
    () =>
      rows
        .filter((r) => !r.active)
        .sort((a, b) => (b.left_on ?? "").localeCompare(a.left_on ?? "")),
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
      // Holiday stays out: it is planned leave, and counting it here would turn a
      // booked week off into the same signal as somebody who did not turn up.
      awayToday: scheduledToday.filter((e) => ["absent", "sick", "unpaid"].includes(byId.get(e.id)?.status ?? "")).length,
      unmarked: scheduledToday.filter((e) => !byId.has(e.id)).length,
      scheduledToday: scheduledToday.length,
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
              {/* The date the board is answering for, with a step either side. The
                  supervisor's question is almost always "yesterday" or "tomorrow",
                  and a date picker makes them type a date to ask it. */}
              <div className="flex items-center gap-1 rounded-md border bg-card p-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  aria-label="Previous day"
                  onClick={() => setBoardDate(new Date(boardDate.getTime() - 86_400_000))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="px-1 text-center leading-tight">
                  <div className="font-mono text-sm font-semibold tabular-nums">
                    {format(boardDate, "dd/MM/yyyy")}
                  </div>
                  <div className="text-2xs text-muted-foreground">{format(boardDate, "EEEE")}</div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  aria-label="Next day"
                  onClick={() => setBoardDate(new Date(boardDate.getTime() + 86_400_000))}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Input
                  type="date"
                  value={boardDateKey}
                  aria-label="Board date"
                  onChange={(e) => e.target.value && setBoardDate(new Date(`${e.target.value}T12:00:00`))}
                  className="h-7 w-[8.5rem] border-0 px-1 text-xs shadow-none focus-visible:ring-0"
                />
              </div>
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

        <Tabs defaultValue="board" className="space-y-4">
          <TabsList className="no-print">
            <TabsTrigger value="board">Daily board</TabsTrigger>
            <TabsTrigger value="monthly">Attendance by month</TabsTrigger>
            <TabsTrigger value="overtime">Overtime</TabsTrigger>
            <TabsTrigger value="people">People</TabsTrigger>
          </TabsList>

          <TabsContent value="board" className="space-y-4">
            <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
              <KpiCard label="Headcount" icon={<Users className="h-3.5 w-3.5" />} value={kpis.headcount} accent="blue" sublabel="Active people on file" />
              <KpiCard label="Shift assigned" icon={<CalendarDays className="h-3.5 w-3.5" />} value={kpis.headcount - kpis.unassigned} accent="ok" sublabel={kpis.unassigned ? `${kpis.unassigned} still without a pattern` : "Everyone has a pattern"} />
              <KpiCard label="Away today" icon={<TrendingDown className="h-3.5 w-3.5" />} value={alerts.awayToday} accent="warning" toneValue sublabel="Absent, sick or unpaid" />
              <KpiCard label="Departments" icon={<Users className="h-3.5 w-3.5" />} value={departments.length} accent="info" sublabel="On the employee list" />
            </div>

            {isLoading ? (
              <Skeleton className="h-64" />
            ) : (
              <HeadcountBoard
                employees={boardEmployees}
                attendance={attendance ?? []}
                onDate={boardDate}
                canEdit={canEdit}
                userId={user?.id}
                onSelect={setDetailId}
              />
            )}

            {alerts.noPattern.length > 0 && (
              <Card className="break-inside-avoid border-amber-500/40">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <AlertTriangle className="h-4 w-4 text-warning-strong" /> Worth a look
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-xs">
                  <p>
                    <b>{alerts.noPattern.length}</b> without a shift pattern, so the board cannot say whether
                    they are due in: {alerts.noPattern.slice(0, 8).map((e) => e.full_name).join(", ")}
                    {alerts.noPattern.length > 8 ? "…" : ""}
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="monthly">
            <MonthlySummary employees={employees ?? []} />
          </TabsContent>

          <TabsContent value="overtime">
            <OvertimePanel
              employees={employees ?? []}
              entries={entries ?? []}
              periods={periods ?? []}
              activePeriod={activePeriod}
              onPeriodChange={setPeriodId}
            />
          </TabsContent>
          <TabsContent value="people" className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-base">People ({onTheList.length})</CardTitle>
                    <div className="flex flex-wrap gap-2 no-print">
                      {canEdit && <AddEmployeeDialog />}
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
                          <TableHead>Source</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {onTheList.length === 0 && (
                          <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Nobody matches these filters</TableCell></TableRow>
                        )}
                        {onTheList.map((r) => (
                          <TableRow key={r.id} className="cursor-pointer" onClick={() => setDetailId(r.id)}>
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
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>

              {/* Kept, not hidden. They hold attendance and overtime that belongs to
                  them, and a leaver who is deleted takes a month's figures with them.
                  Closed by default, because a name on the open list reads as somebody
                  who might be in tomorrow. */}
              {leavers.length > 0 && (
                <details className="rounded-lg border bg-card">
                  <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium marker:content-none">
                    Left the company ({leavers.length})
                    <span className="ml-2 text-2xs font-normal text-muted-foreground">
                      not counted in headcount · still in the monthly summary and their overtime
                    </span>
                  </summary>
                  <div className="overflow-x-auto border-t px-4 pb-3">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Department</TableHead>
                          <TableHead>Shift</TableHead>
                          <TableHead>Left on</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {leavers.map((r) => (
                          <TableRow key={r.id} className="cursor-pointer" onClick={() => setDetailId(r.id)}>
                            <TableCell className="font-medium">{r.full_name}</TableCell>
                            <TableCell className={r.department ? "" : "text-muted-foreground"}>
                              {r.department ?? "to confirm"}
                            </TableCell>
                            <TableCell className="text-xs">{r.shift_group ?? "—"}</TableCell>
                            <TableCell className="font-mono text-xs tabular-nums">
                              {r.left_on
                                ? format(new Date(`${r.left_on}T12:00:00`), "dd/MM/yyyy")
                                : <span className="font-sans text-muted-foreground">no date recorded</span>}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </details>
              )}
          </TabsContent>

        </Tabs>
      </div>

      <EmployeeDetailPanel
        employee={(employees ?? []).find((e) => e.id === detailId) ?? null}
        open={!!detailId}
        onOpenChange={(v) => !v && setDetailId(null)}
        canEdit={canEdit}
      />
    </DashboardLayout>
  );
}
