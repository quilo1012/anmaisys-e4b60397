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
import { ReportPrintHeader } from "@/components/reports/ReportPrintHeader";
import { printElementAsDocument } from "@/lib/printDocument";
import { BackButton } from "@/components/BackButton";
import { Users, Printer } from "lucide-react";
import { format } from "date-fns";
import {
  useEmployees, useOvertimeEntries, useOvertimePeriods, useShiftPatterns, describeDays,
} from "@/hooks/useWorkforce";
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
const PEOPLE_COLUMNS = ["Day", "Night", "Warehouse Day", "Weekend", "Warehouse Weekend", NO_SHIFT];

/** Day and Night read at a glance; the weekend crews are quieter on purpose. */
const SHIFT_BADGE: Record<string, string> = {
  Day: "border-amber-500/40 bg-amber-500/10 text-2xs text-warning-strong",
  Night: "border-indigo-500/40 bg-indigo-500/10 text-2xs text-indigo-700 dark:text-indigo-300",
  Weekend: "border-slate-500/40 bg-slate-500/10 text-2xs text-muted-foreground",
  "Warehouse Day": "border-orange-500/40 bg-orange-500/10 text-2xs text-orange-700 dark:text-orange-300",
  "Warehouse Weekend": "border-slate-500/40 bg-slate-500/10 text-2xs text-muted-foreground",
};

export default function WorkforcePage() {
  const { data: employees, isLoading: loadingEmp } = useEmployees();
  const { data: patterns } = useShiftPatterns();
  const { data: periods, isLoading: loadingPer } = useOvertimePeriods();
  const [periodId, setPeriodId] = useState<string | null>(null);
  const activePeriod = periods?.find((p) => p.id === periodId) ?? periods?.[0] ?? null;
  const { data: entries, isLoading: loadingOT } = useOvertimeEntries(activePeriod?.id ?? null);
  const [search, setSearch] = useState("");
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

  const departments = useMemo(
    () => Array.from(new Set((employees ?? []).map((e) => e.department).filter(Boolean))).sort() as string[],
    [employees],
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

        <Tabs defaultValue="monthly" className="space-y-4">
          <TabsList className="no-print">
            <TabsTrigger value="monthly">Attendance</TabsTrigger>
            <TabsTrigger value="overtime">Overtime</TabsTrigger>
            <TabsTrigger value="people">People</TabsTrigger>
            <TabsTrigger value="leavers">Left</TabsTrigger>
          </TabsList>


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
                      Everyone who works here, by the shift they are on. Click a name to open
                      their record.
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
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                    {PEOPLE_COLUMNS.map((group) => {
                      const here = onTheList.filter((r) =>
                        group === NO_SHIFT ? !r.shift_group : r.shift_group === group,
                      );
                      return (
                        <div key={group} className="flex min-h-[8rem] flex-col rounded-lg border bg-muted/30 p-2 break-inside-avoid">
                          <div className="mb-1.5 flex items-baseline justify-between gap-2 border-b pb-1">
                            <span className="truncate text-xs font-bold uppercase tracking-wide">
                              {group === NO_SHIFT ? "No shift recorded" : group}
                            </span>
                            <span
                              className={cn(
                                "shrink-0 rounded px-1.5 font-mono text-xs font-bold",
                                here.length ? "bg-primary/10 text-primary" : "text-muted-foreground/50",
                              )}
                            >
                              {here.length}
                            </span>
                          </div>
                          <div className="max-h-96 space-y-1 overflow-y-auto print:max-h-none print:overflow-visible">
                            {here.length === 0 && (
                              <p className="px-1 py-1 text-2xs italic text-muted-foreground">Nobody here</p>
                            )}
                            {here.map((r) => {
                              const role = roleStripe(r.department);
                              return (
                                <button
                                  key={r.id}
                                  type="button"
                                  onClick={() => setDetailId(r.id)}
                                  title={[r.full_name, r.department, r.pattern ? describeDays(r.pattern.days) : "No rota"].filter(Boolean).join(" · ")}
                                  className="flex w-full items-center gap-1 rounded-md border bg-card px-1.5 py-1 text-left hover:border-primary"
                                >
                                  {role && (
                                    <span className={cn("shrink-0 rounded-sm px-1 py-px text-[9px] font-bold uppercase leading-tight", role.cls)}>
                                      {role.short}
                                    </span>
                                  )}
                                  <span className="min-w-0 flex-1 truncate text-xs font-medium">{r.full_name}</span>
                                  {!r.pattern && (
                                    <span className="shrink-0 text-[9px] uppercase text-muted-foreground">no rota</span>
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

          <TabsContent value="leavers">
            {/* Their own tab. Kept because they hold attendance and an overtime balance
                that a deletion would take with them, and apart because a leaver beside
                the active list reads as somebody who might be in tomorrow. */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Left the company ({leavers.length})</CardTitle>
                <CardDescription>
                  Not counted in headcount and not on the board. Still counted in the monthly
                  summary for the days they worked, and their overtime balance is still theirs.
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Shift</TableHead>
                      <TableHead>Department</TableHead>
                      <TableHead>Left on</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {leavers.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground">
                          Nobody has left
                        </TableCell>
                      </TableRow>
                    )}
                    {leavers.map((r) => (
                      <TableRow key={r.id} className="cursor-pointer" onClick={() => setDetailId(r.id)}>
                        <TableCell className="font-medium">{r.full_name}</TableCell>
                        <TableCell>
                          {r.shift_group ? (
                            <Badge variant="outline" className={SHIFT_BADGE[r.shift_group] ?? "text-2xs"}>
                              {r.shift_group}
                            </Badge>
                          ) : (
                            <span className="text-2xs text-muted-foreground">not recorded</span>
                          )}
                        </TableCell>
                        <TableCell className={r.department ? "" : "text-muted-foreground"}>
                          {r.department ?? "to confirm"}
                        </TableCell>
                        <TableCell className="font-mono text-xs tabular-nums">
                          {r.left_on
                            ? format(new Date(`${r.left_on}T12:00:00`), "dd/MM/yyyy")
                            : <span className="font-sans text-muted-foreground">no date recorded</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
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
