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
import { PeopleTable } from "@/components/workforce/PeopleTable";
import { OvertimePanel } from "@/components/workforce/OvertimePanel";
import { cn } from "@/lib/utils";
import { useRole } from "@/hooks/useRole";
import { useAuth } from "@/contexts/AuthContext";


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
            {isLoading ? (
              <Skeleton className="h-96" />
            ) : (
              <PeopleTable
                people={onTheList}
                onOpen={setDetailId}
                actions={canEdit ? <AddEmployeeDialog /> : undefined}
              />
            )}
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
