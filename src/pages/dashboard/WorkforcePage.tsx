import { useMemo, useRef, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
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
import { roleStripe } from "@/lib/workforceRoles";
import { cn } from "@/lib/utils";
import { useRole } from "@/hooks/useRole";
import { useAuth } from "@/contexts/AuthContext";

/** The columns of the People tab, in the order the factory says them. */
const NO_SHIFT = "__none__";
/** Last column, and not a shift: the people who left. Kept on the same screen so the
    list reads as the whole story, and last so it is never mistaken for a crew. */
const LEFT = "__left__";
const PEOPLE_COLUMNS = ["Day", "Night", "Warehouse Day", "Weekend", "Warehouse Weekend", NO_SHIFT, LEFT];

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
   * The list is who works here. Leavers are kept, not hidden — they sit in the last
   * column, struck through and dated, so they cannot be read as somebody who might be
   * in tomorrow but are still one click from their record. Newest leaver first.
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
                  <div>
                    <CardTitle className="text-base">People ({onTheList.length})</CardTitle>
                    <CardDescription>
                      Everyone who works here, by the shift they are on, with the people who
                      left in the last column. Click a name to open their record.
                    </CardDescription>
                  </div>
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
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-64" />
                ) : (
                  /* Columns by shift, the way the board is columns by area: the question
                     asked of this list is almost always "who is on nights", and a flat
                     table of 180 names made that a sorting exercise. */
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                    {PEOPLE_COLUMNS.map((group) => {
                      const isLeft = group === LEFT;
                      const here = isLeft
                        ? leavers
                        : onTheList.filter((r) =>
                            group === NO_SHIFT ? !r.shift_group : r.shift_group === group,
                          );
                      return (
                        <div
                          key={group}
                          className={cn(
                            "flex min-h-[8rem] flex-col rounded-lg border p-2 break-inside-avoid",
                            isLeft ? "border-dashed bg-muted/60" : "bg-muted/30",
                          )}
                        >
                          <div className="mb-1.5 flex items-baseline justify-between gap-2 border-b pb-1">
                            <span
                              className={cn(
                                "truncate text-xs font-bold uppercase tracking-wide",
                                isLeft && "text-muted-foreground",
                              )}
                            >
                              {group === NO_SHIFT ? "No shift recorded" : isLeft ? "Left the company" : group}
                            </span>
                            <span
                              className={cn(
                                "shrink-0 rounded px-1.5 font-mono text-xs font-bold",
                                here.length && !isLeft ? "bg-primary/10 text-primary" : "text-muted-foreground/50",
                              )}
                            >
                              {here.length}
                            </span>
                          </div>
                          <div className="max-h-96 space-y-1 overflow-y-auto print:max-h-none print:overflow-visible">
                            {here.length === 0 && (
                              <p className="px-1 py-1 text-2xs italic text-muted-foreground">
                                {isLeft ? "Nobody has left" : "Nobody here"}
                              </p>
                            )}
                            {here.map((r) => {
                              const role = roleStripe(r.department);
                              const leftOn = r.left_on
                                ? format(new Date(`${r.left_on}T12:00:00`), "dd/MM/yy")
                                : null;
                              return (
                                <button
                                  key={r.id}
                                  type="button"
                                  onClick={() => setDetailId(r.id)}
                                  title={
                                    isLeft
                                      ? [r.full_name, r.department, r.shift_group, leftOn ? `Left ${leftOn}` : "No leaving date recorded"].filter(Boolean).join(" · ")
                                      : [r.full_name, r.department, r.pattern ? describeDays(r.pattern.days) : "No rota"].filter(Boolean).join(" · ")
                                  }
                                  className={cn(
                                    "flex w-full items-center gap-1 rounded-md border px-1.5 py-1 text-left hover:border-primary",
                                    isLeft ? "bg-card/50" : "bg-card",
                                  )}
                                >
                                  {role && (
                                    <span className={cn("shrink-0 rounded-sm px-1 py-px text-[9px] font-bold uppercase leading-tight", role.cls)}>
                                      {role.short}
                                    </span>
                                  )}
                                  <span
                                    className={cn(
                                      "min-w-0 flex-1 truncate text-xs font-medium",
                                      isLeft && "text-muted-foreground line-through decoration-muted-foreground/40",
                                    )}
                                  >
                                    {r.full_name}
                                  </span>
                                  {isLeft ? (
                                    <span className="shrink-0 font-mono text-[9px] tabular-nums text-muted-foreground">
                                      {leftOn ?? "—"}
                                    </span>
                                  ) : (
                                    !r.pattern && (
                                      <span className="shrink-0 text-[9px] uppercase text-muted-foreground">no rota</span>
                                    )
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
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
