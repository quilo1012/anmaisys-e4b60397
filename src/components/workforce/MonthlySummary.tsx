import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, CalendarRange } from "lucide-react";
import { format } from "date-fns";
import { downloadCsv } from "@/lib/exportCsv";
import { useAttendanceRange, useOvertimePeriods, type Employee } from "@/hooks/useWorkforce";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Training was on this list from the start and no attendance row has ever carried
// it — 52 records, none of them training. A column that is always zero teaches the
// eye to skip a whole region of the table.
const STATUSES = ["present", "absent", "sick", "holiday", "unpaid"] as const;
type Status = (typeof STATUSES)[number];

const STATUS_LABEL: Record<Status, string> = {
  present: "Present",
  absent: "Absent",
  sick: "Sick",
  holiday: "Holiday",
  unpaid: "Unpaid",
};

/** First and last day of the month a date falls in, as the opening range. */
function monthBounds(d: Date): { from: string; to: string } {
  const y = d.getFullYear();
  const m = d.getMonth();
  const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
}

interface Props {
  employees: Employee[];
}

/**
 * Attendance over any range of days.
 *
 * It used to be a calendar month, which is not the question anybody asks: the payroll
 * close moves, so the period that matters runs 08 Jun to 12 Jul rather than 01 to 30.
 * A month picker forced two exports and a subtraction to answer one question. The
 * payroll periods on file are offered as presets, because typing the boundary from
 * memory is how the wrong fortnight gets reported.
 */
export function MonthlySummary({ employees }: Props) {
  const opening = useMemo(() => monthBounds(new Date()), []);
  const [from, setFrom] = useState(opening.from);
  const [to, setTo] = useState(opening.to);
  const { data: periods } = useOvertimePeriods();
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
        { present: 0, absent: 0, sick: 0, holiday: 0, unpaid: 0 };
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
      `attendance_${from}_to_${to}.csv`,
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
                <CalendarRange className="h-4 w-4" /> Attendance
              </CardTitle>
              <CardDescription>
                {totals.people} people, {totals.recorded} days recorded, {totals.away} away.
                Days nobody marked are not counted either way.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2 no-print">
              {/* The periods on file, so the payroll boundary is picked rather than
                  remembered. Choosing one fills the two dates, which stay editable —
                  a range that only ever matched a saved period would be a dropdown
                  pretending to be a range. */}
              {(periods ?? []).length > 0 && (
                <Select
                  value={periods?.find((p) => p.starts_on === from && p.ends_on === to)?.id ?? "__custom__"}
                  onValueChange={(id) => {
                    const p = periods?.find((x) => x.id === id);
                    if (p) { setFrom(p.starts_on); setTo(p.ends_on); }
                  }}
                >
                  <SelectTrigger className="h-9 w-56"><SelectValue placeholder="Payroll period" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__custom__" disabled>Payroll period…</SelectItem>
                    {(periods ?? []).map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Input type="date" value={from} aria-label="From"
                onChange={(e) => e.target.value && setFrom(e.target.value)} className="h-9 w-[9.5rem]" />
              <span className="text-xs text-muted-foreground">to</span>
              <Input type="date" value={to} aria-label="To"
                onChange={(e) => e.target.value && setTo(e.target.value)} className="h-9 w-[9.5rem]" />
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
                    <TableCell colSpan={STATUSES.length + 2} className="text-center text-muted-foreground">
                      Nothing was marked between {format(new Date(`${from}T12:00:00`), "dd MMM yyyy")} and {format(new Date(`${to}T12:00:00`), "dd MMM yyyy")}
                    </TableCell>
                  </TableRow>
                )}
                {attendanceRows.map((r) => (
                  <TableRow key={r.employeeId}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    {STATUSES.map((s) => (
                      <TableCell
                        key={s}
                        className={`text-right font-figure ${r[s] === 0 ? "text-muted-foreground" : ""}`}
                      >
                        {r[s]}
                      </TableCell>
                    ))}
                    <TableCell className="text-right font-figure font-semibold">{r.recorded}</TableCell>
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
