import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, CalendarRange } from "lucide-react";
import { format } from "date-fns";
import { downloadCsv } from "@/lib/exportCsv";
import { useAttendanceRange, type Employee } from "@/hooks/useWorkforce";

const STATUSES = ["present", "absent", "sick", "holiday", "training"] as const;
type Status = (typeof STATUSES)[number];

const STATUS_LABEL: Record<Status, string> = {
  present: "Present",
  absent: "Absent",
  sick: "Sick",
  holiday: "Holiday",
  training: "Training",
};

/** First and last day of a `YYYY-MM` string, as dates the query can use. */
function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

interface Props {
  employees: Employee[];
}

/**
 * Attendance over a calendar month. Attendance only.
 *
 * Overtime lives on its own tab because it cannot answer this question: its rows are
 * one total per person per payroll period, and the loaded period runs 08 Jun to
 * 12 Jul. Reporting "June overtime" would mean splitting a payroll figure nobody
 * split. Attendance is one row per person per day, so a month is a real question.
 */
export function MonthlySummary({ employees }: Props) {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const { from, to } = useMemo(() => monthBounds(month), [month]);
  const { data: attendance, isLoading } = useAttendanceRange(from, to);

  const nameById = useMemo(
    () => new Map(employees.map((e) => [e.id, e])),
    [employees],
  );

  const attendanceRows = useMemo(() => {
    const byEmployee = new Map<string, Record<Status, number>>();
    for (const a of attendance ?? []) {
      if (!STATUSES.includes(a.status as Status)) continue;
      const counts =
        byEmployee.get(a.employee_id) ??
        { present: 0, absent: 0, sick: 0, holiday: 0, training: 0 };
      counts[a.status as Status] += 1;
      byEmployee.set(a.employee_id, counts);
    }
    return Array.from(byEmployee.entries())
      .map(([employeeId, counts]) => {
        const emp = nameById.get(employeeId);
        const recorded = STATUSES.reduce((s, k) => s + counts[k], 0);
        return {
          employeeId,
          name: emp?.full_name ?? "Employee no longer on file",
          department: emp?.department ?? "",
          ...counts,
          recorded,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [attendance, nameById]);

  const totals = useMemo(() => {
    const recorded = attendanceRows.reduce((s, r) => s + r.recorded, 0);
    const away = attendanceRows.reduce((s, r) => s + r.absent + r.sick, 0);
    return { recorded, away, people: attendanceRows.length };
  }, [attendanceRows]);

  function exportAttendance() {
    downloadCsv(
      `attendance_${month}.csv`,
      ["Employee", "Department", ...STATUSES.map((s) => STATUS_LABEL[s]), "Days recorded"],
      attendanceRows.map((r) => [r.name, r.department, ...STATUSES.map((s) => r[s]), r.recorded]),
    );
  }

  return (
    <div className="space-y-4">
      <Card className="break-inside-avoid">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarRange className="h-4 w-4" /> Attendance by month
              </CardTitle>
              <CardDescription>
                {totals.people} people, {totals.recorded} days recorded, {totals.away} away.
                Days nobody marked are not counted either way.
              </CardDescription>
            </div>
            <div className="flex gap-2 no-print">
              <Input
                type="month"
                value={month}
                onChange={(e) => e.target.value && setMonth(e.target.value)}
                className="h-9 w-40"
              />
              <Button variant="outline" size="sm" onClick={exportAttendance} disabled={!attendanceRows.length}>
                <Download className="mr-1 h-4 w-4" /> CSV
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {isLoading ? (
            <Skeleton className="h-48" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  {STATUSES.map((s) => (
                    <TableHead key={s} className="text-right">{STATUS_LABEL[s]}</TableHead>
                  ))}
                  <TableHead className="text-right">Recorded</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attendanceRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground">
                      Nothing was marked in {format(new Date(`${month}-01T12:00:00`), "MMMM yyyy")}
                    </TableCell>
                  </TableRow>
                )}
                {attendanceRows.map((r) => (
                  <TableRow key={r.employeeId}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    {STATUSES.map((s) => (
                      <TableCell
                        key={s}
                        className={`text-right font-mono tabular-nums ${r[s] === 0 ? "text-muted-foreground" : ""}`}
                      >
                        {r[s]}
                      </TableCell>
                    ))}
                    <TableCell className="text-right font-mono tabular-nums font-semibold">{r.recorded}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
