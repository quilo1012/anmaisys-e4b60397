import { useMemo, useState } from "react";
import { format } from "date-fns";
import { Users } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { BackButton } from "@/components/BackButton";
import { AdminPinGate } from "@/components/AdminPinGate";
import { WorkforceTabs } from "@/components/workforce/WorkforceTabs";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AddEmployeeDialog } from "@/components/workforce/AddEmployeeDialog";
import { DepartmentHeadcount } from "@/components/workforce/DepartmentHeadcount";
import { EmployeeDetailPanel } from "@/components/workforce/EmployeeDetailPanel";
import { PeopleTable } from "@/components/workforce/PeopleTable";
import { useEmployees, useShiftPatterns } from "@/hooks/useWorkforce";
import { useRole } from "@/hooks/useRole";

/** Day and Night read at a glance; the weekend crews are quieter on purpose. */
const SHIFT_BADGE: Record<string, string> = {
  Day: "border-amber-500/40 bg-amber-500/10 text-2xs text-warning-strong",
  Night: "border-indigo-500/40 bg-indigo-500/10 text-2xs text-indigo-700 dark:text-indigo-300",
  Weekend: "border-slate-500/40 bg-slate-500/10 text-2xs text-muted-foreground",
  "Warehouse Day": "border-orange-500/40 bg-orange-500/10 text-2xs text-orange-700 dark:text-orange-300",
  "Warehouse Weekend": "border-slate-500/40 bg-slate-500/10 text-2xs text-muted-foreground",
};

/**
 * The employee records: who is on the books, and who has left.
 *
 * This was the People and Left tabs of the Workforce screen, which was retired
 * because everything else on it had been rebuilt elsewhere. These two had not — this
 * is still the only place an employee can be added, or a department, rota or leaving
 * date corrected, and the board, Leave and Finance Close all read what is set here.
 */
export default function PeoplePage() {
  const { data: employees, isLoading } = useEmployees();
  const { data: patterns } = useShiftPatterns();
  const { can } = useRole();
  const canEdit = can("workforce.manage");
  const [detailId, setDetailId] = useState<string | null>(null);

  const patternById = useMemo(
    () => new Map((patterns ?? []).map((p) => [p.id, p])),
    [patterns],
  );

  const rows = useMemo(
    () =>
      (employees ?? []).map((e) => ({
        ...e,
        pattern: e.shift_pattern_id ? patternById.get(e.shift_pattern_id) ?? null : null,
        overtime: null,
      })),
    [employees, patternById],
  );

  const onTheList = useMemo(() => rows.filter((r) => r.active), [rows]);
  const leavers = useMemo(
    () =>
      rows
        .filter((r) => !r.active)
        .sort((a, b) => (b.left_on ?? "").localeCompare(a.left_on ?? "")),
    [rows],
  );

  return (
    <DashboardLayout>
      {/* The one door in this section that had no lock. Every other tab — the board,
          Annual Leave, Attendance, Finance Close — asks for the PIN, and this screen
          holds more than any of them: every employee's department, rota, pay-relevant
          entitlement and leaving date. Somebody who could not open the board could open
          this and then walk into the board through the tabs.
          Same key as the rest, so it is still one PIN for the section and not five. */}
      <AdminPinGate
        storageKey="workforce"
        title="Employee"
        description="The employee records behind the board. Enter the admin PIN to open."
      >
      <div className="space-y-4">
        <BackButton />
        <WorkforceTabs />

        <div className="flex items-center gap-3">
          <Users className="h-6 w-6 text-muted-foreground" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Employee</h1>
            <p className="text-sm text-muted-foreground">
              The employee records the board, Leave and Finance Close all read from
            </p>
          </div>
        </div>

        <Tabs defaultValue="people" className="space-y-4">
          <TabsList>
            <TabsTrigger value="people">On the books ({onTheList.length})</TabsTrigger>
            <TabsTrigger value="leavers">Left ({leavers.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="people" className="space-y-4">
            {isLoading ? (
              <Skeleton className="h-96" />
            ) : (
              <>
                <DepartmentHeadcount people={rows} canEdit={canEdit} />
                <PeopleTable
                  leftCount={leavers.length}
                  people={onTheList}
                  onOpen={setDetailId}
                  actions={canEdit ? <AddEmployeeDialog /> : undefined}
                />
              </>
            )}
          </TabsContent>

          <TabsContent value="leavers">
            {/* Kept, not deleted: they hold attendance and an overtime balance that a
                deletion would take with them. Apart from the active list, because a
                leaver beside it reads as somebody who might be in tomorrow. */}
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
      </AdminPinGate>
    </DashboardLayout>
  );
}
