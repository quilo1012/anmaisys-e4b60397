import { useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KpiCard } from "@/components/reports/KpiCard";
import { Clock, Download, TrendingDown, Users } from "lucide-react";
import { format } from "date-fns";
import { downloadCsv } from "@/lib/exportCsv";
import type { Employee, OvertimeEntry } from "@/hooks/useWorkforce";

const fmtHours = (h: number) => `${h.toFixed(2).replace(/\.00$/, "")}h`;

interface Props {
  employees: Employee[];
  entries: OvertimeEntry[];
  /**
   * The period the page is on. Not chosen here: this panel had a picker of its own,
   * reading a second table of periods, so the register could sit on June while the
   * close above it read July — and what is keyed here IS the Payroll OT column up
   * there. One period per page, chosen once, in the header.
   */
  activePeriod: { id: string; name: string; start_date: string; end_date: string } | null;
}

/**
 * Overtime on its own, with its own period selector.
 *
 * It used to run down the middle of the headcount screen — a badge on every person
 * on the daily board, a column in the people table, a KPI beside the headcount. The
 * two answer different questions over different spans: the board is one day, this is
 * a payroll period. Sharing a screen made them read as one figure.
 *
 * Read-only, and it says so. The hours are a copy of the payroll spreadsheet and the
 * database refuses to let them be edited here; a correction goes to the sheet and
 * comes back on the next import.
 */
export function OvertimePanel({ employees, entries, activePeriod }: Props) {
  const nameById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);

  const rows = useMemo(
    () =>
      entries
        .map((e) => {
          const emp = nameById.get(e.employee_id);
          return {
            id: e.id,
            employeeId: e.employee_id,
            name: emp?.full_name ?? "Employee no longer on file",
            department: emp?.department ?? "",
            hours: Number(e.hours),
            note: e.note ?? "",
            importedAt: e.imported_at ?? null,
            sourceNote: e.source_note ?? null,
          };
        })
        .sort((a, b) => b.hours - a.hours),
    [entries, nameById],
  );

  const kpis = useMemo(() => {
    const negative = rows.filter((r) => r.hours < 0);
    return {
      total: rows.reduce((s, r) => s + r.hours, 0),
      people: rows.length,
      negative,
      negativeHours: negative.reduce((s, r) => s + r.hours, 0),
    };
  }, [rows]);

  const periodLabel = activePeriod
    ? `${format(new Date(activePeriod.start_date), "dd/MM/yyyy")} — ${format(new Date(activePeriod.end_date), "dd/MM/yyyy")}`
    : null;

  const provenance = rows.find((r) => r.importedAt);

  function exportCsv() {
    downloadCsv(
      `overtime_${activePeriod?.start_date ?? "period"}_to_${activePeriod?.end_date ?? ""}.csv`,
      ["Employee", "Department", "Hours (balance)", "Note", "Period"],
      rows.map((r) => [r.name, r.department, r.hours, r.note, periodLabel ?? ""]),
    );
  }

  return (
    <div className="space-y-4">
      <Card className="break-inside-avoid">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base">Overtime</CardTitle>
              <CardDescription>
                {periodLabel ? `Payroll period ${periodLabel}` : "No period loaded"} — a balance, not hours
                worked. Sickness is written off against banked hours, so a negative figure is real.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2 no-print">
              <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length}>
                <Download className="mr-1 h-4 w-4" /> CSV
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Hours in period"
            icon={<Clock className="h-3.5 w-3.5" />}
            value={fmtHours(kpis.total)}
            accent="purple"
            sublabel={periodLabel ?? "—"}
          />
          <KpiCard
            label="People with a balance"
            icon={<Users className="h-3.5 w-3.5" />}
            value={kpis.people}
            accent="blue"
            sublabel="Carrying hours this period"
          />
          <KpiCard
            label="Negative balances"
            icon={<TrendingDown className="h-3.5 w-3.5" />}
            value={kpis.negative.length}
            accent="warning"
            toneValue
            sublabel={
              kpis.negative.length
                ? `${fmtHours(kpis.negativeHours)} written off to sickness`
                : "Nobody in deficit"
            }
          />
          <KpiCard
            label="Average"
            icon={<Clock className="h-3.5 w-3.5" />}
            value={kpis.people ? fmtHours(kpis.total / kpis.people) : "—"}
            accent="info"
            sublabel="Across those with a balance"
          />
        </CardContent>
      </Card>

      {provenance && (
        // Said on the screen, not only in the migration: the factory pays from the
        // sheet this was copied from, and a correction belongs there.
        <p className="rounded border bg-muted/40 p-2 text-2xs text-muted-foreground">
          Imported from the payroll spreadsheet
          {provenance.sourceNote ? ` — ${provenance.sourceNote}` : ""}
          {" · "}
          {format(new Date(provenance.importedAt as string), "dd/MM/yyyy HH:mm")}. Not calculated here, and
          not editable here: corrections go to the spreadsheet and return on the next import.
        </p>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Balances ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Department</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No overtime recorded for this period
                  </TableCell>
                </TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className={r.department ? "" : "text-muted-foreground"}>
                    {r.department || "to confirm"}
                  </TableCell>
                  <TableCell
                    className={`text-right font-figure ${r.hours < 0 ? "font-bold text-destructive-strong" : ""}`}
                  >
                    {fmtHours(r.hours)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.hours < 0 && !r.note ? (
                      <Badge variant="outline" className="border-warning/40 bg-warning/10 text-2xs text-warning-strong">
                        Sickness against banked hours
                      </Badge>
                    ) : (
                      r.note
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
