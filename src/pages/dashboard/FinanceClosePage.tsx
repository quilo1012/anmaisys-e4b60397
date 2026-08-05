import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { BackButton } from "@/components/BackButton";
import { WorkforceTabs } from "@/components/workforce/WorkforceTabs";
import { AdminPinGate } from "@/components/AdminPinGate";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Calculator, Download, Printer, AlertTriangle } from "lucide-react";
import { downloadCsv } from "@/lib/exportCsv";
import { OvertimePanel } from "@/components/workforce/OvertimePanel";
import { useEmployees, useOvertimeEntries, useOvertimePeriods } from "@/hooks/useWorkforce";
import {
  buildClose, closeTotals, closeToCsvRows, CLOSE_HEADERS, type ClosePersonInput,
} from "@/lib/financeClose";

/**
 * The pay period handed to finance: overtime and time off, per person.
 *
 * The factory keeps overtime in two places. `attendance_days` is what the clocks
 * recorded; `overtime_entries` is what the office keyed from the payroll sheet. They
 * disagreed by two hundred hours the last time anybody checked, so this screen puts
 * them side by side with the gap rather than adding them into one number that would
 * pay one of the two without saying which.
 */
export default function FinanceClosePage() {
  const [periodId, setPeriodId] = useState<string>("");

  // The overtime register, which used to live on the Workforce screen. It is the
  // source of the Payroll OT column below, so keying it anywhere else meant leaving
  // this page to fill in the very number this page says is missing.
  const { data: otEmployees } = useEmployees();
  const { data: otPeriods } = useOvertimePeriods();
  const [otPeriodId, setOtPeriodId] = useState<string | null>(null);
  const otPeriod = otPeriods?.find((p) => p.id === otPeriodId) ?? otPeriods?.[0] ?? null;
  const { data: otEntries } = useOvertimeEntries(otPeriod?.id ?? null);

  const { data: periods = [] } = useQuery({
    queryKey: ["payroll-periods"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("workforce_payroll_periods")
        .select("id, name, start_date, end_date")
        .order("start_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as { id: string; name: string; start_date: string; end_date: string }[];
    },
  });

  // The period covering today, so the screen opens on the one being closed.
  const period = useMemo(() => {
    if (periodId) return periods.find((p) => p.id === periodId) ?? null;
    const today = new Date().toISOString().slice(0, 10);
    return periods.find((p) => p.start_date <= today && p.end_date >= today) ?? periods[0] ?? null;
  }, [periods, periodId]);

  const from = period?.start_date ?? "";
  const to = period?.end_date ?? "";

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["finance-close", from, to, period?.id],
    enabled: !!period,
    queryFn: async () => {
      const db = supabase as any;
      const [emp, clocked, payroll, manual] = await Promise.all([
        db.from("employees").select("id, full_name, department").eq("active", true),
        db.from("attendance_days")
          .select("employee_id, worked_minutes, balance_minutes, absence_name")
          .gte("on_date", from).lte("on_date", to),
        db.from("overtime_entries").select("employee_id, hours").eq("period_id", period!.id),
        // `on_date`, not `date` — the column the manual marks actually use.
        db.from("employee_attendance").select("employee_id, status")
          .gte("on_date", from).lte("on_date", to),
      ]);
      for (const r of [emp, clocked, payroll, manual]) if (r.error) throw r.error;

      const byId = new Map<string, ClosePersonInput>();
      for (const e of (emp.data ?? []) as any[]) {
        byId.set(e.id, {
          employeeId: e.id, name: e.full_name, department: e.department ?? null,
          clockedBalanceMin: null, payrollOtHours: null, absences: {}, daysPresent: 0,
        });
      }

      for (const d of (clocked.data ?? []) as any[]) {
        const p = byId.get(d.employee_id); if (!p) continue;
        p.clockedBalanceMin = (p.clockedBalanceMin ?? 0) + (d.balance_minutes ?? 0);
        if (d.absence_name) p.absences[d.absence_name] = (p.absences[d.absence_name] ?? 0) + 1;
        else if ((d.worked_minutes ?? 0) > 0) p.daysPresent += 1;
      }

      for (const o of (payroll.data ?? []) as any[]) {
        const p = byId.get(o.employee_id); if (!p) continue;
        p.payrollOtHours = (p.payrollOtHours ?? 0) + Number(o.hours ?? 0);
      }

      // The hand-marked day statuses, which are the only absence record until a
      // TimeMoto import runs.
      for (const a of (manual.data ?? []) as any[]) {
        const p = byId.get(a.employee_id); if (!p) continue;
        if (a.status && a.status !== "present") {
          p.absences[a.status] = (p.absences[a.status] ?? 0) + 1;
        } else if (a.status === "present") {
          p.daysPresent += 1;
        }
      }

      // Only people with something to report in the period.
      return buildClose([...byId.values()].filter(
        (p) => p.clockedBalanceMin != null || p.payrollOtHours != null
          || p.daysPresent > 0 || Object.keys(p.absences).length > 0,
      ));
    },
  });

  const totals = useMemo(() => closeTotals(rows), [rows]);
  const num = (n: number | null) => (n == null ? "—" : n.toFixed(2));

  return (
    <DashboardLayout>
      <AdminPinGate
        storageKey="workforce"
        title="Finance Close"
        description="Overtime and time off per person, for the pay period. Enter the admin PIN to open."
      >
      <div className="space-y-4">
        <BackButton className="print:hidden" />
        <WorkforceTabs />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Calculator className="h-6 w-6 text-muted-foreground" />
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Finance Close</h1>
              <p className="text-sm text-muted-foreground">
                {period ? `${period.name} · ${from} → ${to}` : "No pay period set"}
              </p>
            </div>
          </div>
          <div className="flex gap-2 print:hidden">
            <Button size="sm" variant="outline" onClick={() => window.print()}>
              <Printer className="mr-1.5 h-4 w-4" /> Print
            </Button>
            <Button
              size="sm"
              disabled={rows.length === 0}
              onClick={() => downloadCsv(
                `finance-close-${period?.name?.replace(/\s+/g, "-").toLowerCase() ?? from}.csv`,
                CLOSE_HEADERS,
                closeToCsvRows(rows),
              )}
            >
              <Download className="mr-1.5 h-4 w-4" /> Export
            </Button>
          </div>
        </div>

        <div className="print:hidden">
          <Label className="text-xs">Pay period</Label>
          <Select value={period?.id ?? ""} onValueChange={setPeriodId}>
            <SelectTrigger className="mt-1 h-9 w-[320px]"><SelectValue placeholder="Choose a period" /></SelectTrigger>
            <SelectContent>
              {periods.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name} · {p.start_date} → {p.end_date}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {[
            { label: "People", value: String(totals.people) },
            // What is paid, not the balance. The balance nets a shortfall against a
            // surplus and is not itself a figure anybody is paid.
            { label: "Overtime paid", value: `${totals.overtimeHours.toFixed(2)} h` },
            { label: "Hours deducted", value: `${totals.owedHours.toFixed(2)} h` },
            { label: "Payroll OT", value: `${totals.payrollOtHours.toFixed(2)} h` },
            {
              label: "Gap to settle",
              // Nothing keyed means nothing to compare, and saying "0.00 h" would
              // tell somebody the two sides agree.
              value: totals.payrollEmpty ? "not comparable" : `${totals.deltaHours.toFixed(2)} h`,
            },
          ].map((k) => (
            <Card key={k.label}>
              <CardContent className="p-3">
                <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">{k.label}</div>
                <div className="font-mono text-xl font-bold tabular-nums">{k.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Said before the table, not in a footnote: somebody is about to pay from
            this, and the two columns are not two halves of a total. */}
        <p className="flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-2xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning-strong" />
          <span>
            Hours are not settled week by week. The contract is a four-day, forty-four hour week,
            and somebody who works 40 h one week and 52 h the next has <b>not</b> earned eight hours
            of overtime — the second week pays back the first. The <b>pay period</b> is what settles:
            whatever the balance comes to over these 28 days is paid as overtime if it is positive
            and deducted from pay if it is negative, so the next period starts at zero.
            <b>Payroll OT</b> is what the office keyed in; the two are never added together, and the
            <b>Δ</b> is the disagreement to settle before anybody is paid. A dash means that side
            reported nothing, which is not zero.
            {totals.payrollEmpty && (
              <> <b className="text-warning-strong">No payroll overtime has been keyed for this period at all</b>,
                so there is nothing to compare and the gap cannot be read as agreement.</>
            )}
            {!totals.payrollEmpty && totals.unreconciled > 0 && (
              <> <b>{totals.unreconciled}</b> {totals.unreconciled === 1 ? "person has" : "people have"} a
                figure on one side only.</>
            )}
          </span>
        </p>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6 text-center text-sm text-muted-foreground">Loading…</div>
            ) : rows.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                Nothing recorded in this period. Overtime arrives from a TimeMoto import on the
                Attendance page, or from the office keying it into the overtime register.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Department</TableHead>
                      <TableHead className="text-right">Period balance</TableHead>
                      <TableHead className="text-right">Overtime</TableHead>
                      <TableHead className="text-right">Deducted</TableHead>
                      <TableHead className="text-right">Payroll OT</TableHead>
                      <TableHead className="text-right">Δ</TableHead>
                      <TableHead className="text-right">Present</TableHead>
                      <TableHead className="text-right">Sick</TableHead>
                      <TableHead className="text-right">Holiday</TableHead>
                      <TableHead className="text-right">Unpaid</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.employeeId}>
                        <TableCell className="font-medium">{r.name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.department ?? "—"}</TableCell>
                        <TableCell className={`text-right font-mono tabular-nums ${
                          (r.clockedOtHours ?? 0) < 0 ? "text-destructive-strong" : ""}`}>
                          {num(r.clockedOtHours)}
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold tabular-nums">
                          {num(r.overtimeHours)}
                        </TableCell>
                        <TableCell className={`text-right font-mono tabular-nums ${
                          (r.owedHours ?? 0) > 0 ? "text-warning-strong" : "text-muted-foreground"}`}>
                          {r.owedHours ? r.owedHours.toFixed(2) : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{num(r.payrollOtHours)}</TableCell>
                        <TableCell className={`text-right font-mono font-semibold tabular-nums ${
                          r.deltaHours == null ? "text-muted-foreground"
                            : Math.abs(r.deltaHours) >= 1 ? "text-destructive-strong" : ""}`}>
                          {num(r.deltaHours)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{r.daysPresent}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{r.sick || "—"}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{r.holiday || "—"}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{r.unpaid || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Where the Payroll OT column above is filled in. */}
        <div className="space-y-2 print:hidden">
          <h2 className="text-lg font-semibold tracking-tight">Overtime register</h2>
          <p className="text-sm text-muted-foreground">
            Hours keyed from the payroll sheet. What is entered here becomes the
            <b> Payroll OT</b> column above.
          </p>
          <OvertimePanel
            employees={otEmployees ?? []}
            entries={otEntries ?? []}
            periods={otPeriods ?? []}
            activePeriod={otPeriod}
            onPeriodChange={setOtPeriodId}
          />
        </div>
      </div>
      </AdminPinGate>
    </DashboardLayout>
  );
}
