import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
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
import { useEmployees, useOvertimeEntries } from "@/hooks/useWorkforce";
import { boardShiftFor } from "@/hooks/useHeadcount";
import {
  buildClose, closeTotals, closeToCsvRows, CLOSE_HEADERS, round2, type ClosePersonInput,
} from "@/lib/financeClose";
import { earlyLeave } from "@/lib/earlyLeave";
import { ModuleHeader } from "@/components/ui/ModuleHeader";
import { Figure, FigureRow } from "@/components/ui/Figure";

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
  // source of the Payroll OT column, so keying it anywhere else meant leaving this page
  // to fill in the very number this page says is missing.
  //
  // It had a period picker of its own, reading a SECOND table of periods
  // (`overtime_periods`, two rows, against `workforce_payroll_periods`' twenty-nine).
  // So the register could sit on June while the close above it read July. Both tables
  // described the same pay periods; the entries table was empty, so the key was
  // repointed and the duplicate dropped.
  const { data: otEmployees } = useEmployees();

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

  // The register reads the same period as everything else on the page.
  const { data: otEntries } = useOvertimeEntries(period?.id ?? null);

  const from = period?.start_date ?? "";
  const to = period?.end_date ?? "";

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["finance-close", from, to, period?.id],
    enabled: !!period,
    queryFn: async () => {
      const db = supabase as any;
      const [emp, clocked, opening, payroll, manual, board, rotas] = await Promise.all([
        db.from("employees")
          .select("id, full_name, department, shift_group, shift_pattern_id, shift_patterns(name, days)")
          .eq("active", true),
        // Paged, because this is what somebody is paid from. A pay period holds more
        // than a thousand attendance rows and PostgREST caps an unbounded select there
        // silently — the close would simply have counted fewer days for whoever sorted
        // last.
        fetchAllRows<any>({
          range: (a, b) => db.from("attendance_days")
            .select("employee_id, worked_minutes, balance_minutes, absence_name")
            .gte("on_date", from).lte("on_date", to)
            .order("on_date", { ascending: true }).order("employee_id", { ascending: true })
            .range(a, b),
        }).then((data: any[]) => ({ data, error: null })),
        // Everything before the period: the hour bank as it stood when it opened. The
        // balance runs on, so a shortfall from September is still owed in October and
        // is worked off against those hours one for one.
        fetchAllRows<any>({
          range: (a, b) => db.from("attendance_days")
            .select("employee_id, balance_minutes")
            .lt("on_date", from)
            .order("on_date", { ascending: true }).order("employee_id", { ascending: true })
            .range(a, b),
        }).then((data: any[]) => ({ data, error: null })),
        db.from("overtime_entries").select("employee_id, hours").eq("period_id", period!.id),
        // `on_date`, not `date` — the column the manual marks actually use.
        fetchAllRows<any>({
          range: (a, b) => db.from("employee_attendance").select("employee_id, status")
            .gte("on_date", from).lte("on_date", to)
            .order("on_date", { ascending: true }).order("employee_id", { ascending: true })
            .range(a, b),
        }).then((data: any[]) => ({ data, error: null })),
        // Days somebody came in for and went home part-way through. Nothing has ever
        // counted these: the board stored the time and every screen still recorded a
        // full day.
        // The whole board for the period, not just the early leavers. It answers the
        // other question — how many shifts were they due and how many did they come to
        // — which used to be a second table underneath this one, over the same people
        // and the same dates. Paged: this period holds 1524 rows and PostgREST returns
        // a thousand without a word.
        fetchAllRows<any>({
          range: (a, b) => db.from("daily_allocations")
            .select("employee_id, on_date, status, shift, left_early_at")
            .gte("on_date", from).lte("on_date", to)
            .order("on_date", { ascending: true }).order("employee_id", { ascending: true })
            .range(a, b),
        }).then((data: any[]) => ({ data, error: null })),
        db.from("shift_patterns").select("id, starts_at, ends_at, break_minutes"),
      ]);
      for (const r of [emp, clocked, opening, payroll, manual, board, rotas]) if (r.error) throw r.error;

      // Which DAYS each board was filled in for, not merely whether it ever was.
      //
      // This was a set of shift names, and one planned day made a whole period count.
      // The Night board holds thirty names on 07/08 and nothing on the other
      // twenty-seven days of this period, so that single day flipped all forty-eight of
      // the night crew from excluded to a full period short. The Day board is empty on
      // 31/07 and holds two names on 06/08 — two Fridays and Thursdays that would read
      // as everybody failing to turn up.
      const plannedByShift = new Map<string, Set<string>>();
      for (const a of (board.data ?? []) as any[]) {
        if (!a.shift) continue;
        if (!plannedByShift.has(a.shift)) plannedByShift.set(a.shift, new Set());
        plannedByShift.get(a.shift)!.add(a.on_date);
      }

      const byId = new Map<string, ClosePersonInput>();
      for (const e of (emp.data ?? []) as any[]) {
        const crew = boardShiftFor(e.shift_group);
        byId.set(e.id, {
          employeeId: e.id, name: e.full_name, department: e.department ?? null,
          shift: crew,
          openingBalanceMin: null, clockedBalanceMin: null,
          payrollOtHours: null, absences: {}, daysPresent: 0,
          earlyLeaveHours: 0,
          patternName: e.shift_patterns?.name ?? null,
          patternDays: e.shift_patterns?.days ?? null,
          shiftsWorked: 0, shiftsHoliday: 0,
          plannedDates: plannedByShift.get(crew ?? "Day") ?? new Set<string>(),
        });
      }

      // The rota is what says how long the shift was, so a person with none on file
      // contributes nothing to the early-leave figure rather than a guessed shortfall.
      const rotaById = new Map(((rotas.data ?? []) as any[]).map((p) => [p.id, p]));
      const patternOf = new Map(
        ((emp.data ?? []) as any[]).map((e) => [e.id, rotaById.get(e.shift_pattern_id)]),
      );

      // One pass over the board for both answers it holds: shifts turned up for, and
      // hours of a shift somebody came in for and did not stay for.
      for (const a of (board.data ?? []) as any[]) {
        const p = byId.get(a.employee_id); if (!p) continue;
        if (a.status === "assigned" || a.status === "overtime") p.shiftsWorked += 1;
        else if (a.status === "holiday") p.shiftsHoliday += 1;

        if (!a.left_early_at) continue;
        const rota = patternOf.get(a.employee_id);
        if (!rota) continue;
        const cut = earlyLeave(a.left_early_at, {
          startsAt: rota.starts_at, endsAt: rota.ends_at, breakMinutes: rota.break_minutes,
        });
        if (cut) p.earlyLeaveHours = round2(p.earlyLeaveHours + cut.missedHours);
      }

      for (const o of (opening.data ?? []) as any[]) {
        const p = byId.get(o.employee_id); if (!p) continue;
        p.openingBalanceMin = (p.openingBalanceMin ?? 0) + (o.balance_minutes ?? 0);
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
      // Anybody the period touched — a rota that expected them, a clock that recorded
      // them, or a mark on the board. The shift side works for everybody today, which
      // the hours side does not: `attendance_days` is empty until TimeMoto is imported.
      return buildClose(
        [...byId.values()].filter(
          (p) => p.clockedBalanceMin != null || p.payrollOtHours != null
            || p.openingBalanceMin != null
            || p.daysPresent > 0 || Object.keys(p.absences).length > 0
            || p.earlyLeaveHours > 0
            || p.shiftsWorked > 0 || p.shiftsHoliday > 0
            || !!p.patternDays?.length,
        ),
        from, to,
      );
    },
  });

  /**
   * Day, Night, or both together.
   *
   * The night crew is forty-eight people on a rota of its own and its overtime behaves
   * nothing like the day crews' — reading one figure for the whole factory hid which
   * side of the factory the hours were on. "Both" is the default because the close is a
   * whole-factory document; the two subtotals add up to it exactly, since a person
   * belongs to one crew.
   */
  const [shiftFilter, setShiftFilter] = useState<"all" | "Day" | "Night">("all");
  const shown = useMemo(
    () => (shiftFilter === "all" ? rows : rows.filter((r) => r.shift === shiftFilter)),
    [rows, shiftFilter],
  );

  const totals = useMemo(() => closeTotals(shown), [shown]);
  /** Both crews side by side, so the split is readable without touching the filter. */
  const byShift = useMemo(
    () => (["Day", "Night"] as const).map((s) => ({
      shift: s,
      ...closeTotals(rows.filter((r) => r.shift === s)),
    })).filter((t) => t.people > 0),
    [rows],
  );
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

        <ModuleHeader
          title="Finance Close"
          description={period ? `${period.name} · ${from} → ${to}` : "No pay period set"}
        >
          {/* In the header rather than under it: choosing the period and the shift is
              choosing what the whole page is about, and both were sitting below the
              title as though they were filters on a table. */}
          <Select value={period?.id ?? ""} onValueChange={setPeriodId}>
            <SelectTrigger className="h-9 w-[260px] border-white/25 bg-white/10 text-white">
              <SelectValue placeholder="Choose a period" />
            </SelectTrigger>
            <SelectContent>
              {periods.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name} · {p.start_date} → {p.end_date}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={shiftFilter} onValueChange={(v) => setShiftFilter(v as typeof shiftFilter)}>
            <SelectTrigger className="h-9 w-[150px] border-white/25 bg-white/10 text-white"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Both shifts</SelectItem>
              <SelectItem value="Day">Day only</SelectItem>
              <SelectItem value="Night">Night only</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="secondary" className="print:hidden" onClick={() => window.print()}>
            <Printer className="mr-1.5 h-4 w-4" /> Print
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="print:hidden"
            disabled={shown.length === 0}
            onClick={() => downloadCsv(
              `finance-close-${period?.name?.replace(/\s+/g, "-").toLowerCase() ?? from}.csv`,
              CLOSE_HEADERS,
              closeToCsvRows(shown),
            )}
          >
            <Download className="mr-1.5 h-4 w-4" /> Export
          </Button>
        </ModuleHeader>

        {/* The split, whatever the filter says. A close read as one number hid that the
            night crew's overtime behaves nothing like the day crews'. */}
        {byShift.length > 1 && (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Shift</TableHead>
                    <TableHead className="text-right">People</TableHead>
                    <TableHead className="text-right">Overtime paid</TableHead>
                    <TableHead className="text-right">Hours deducted</TableHead>
                    <TableHead className="text-right">Payroll OT</TableHead>
                    <TableHead className="text-right">Gap to settle</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byShift.map((t) => (
                    <TableRow
                      key={t.shift}
                      className={shiftFilter === t.shift ? "bg-muted/50" : undefined}
                    >
                      <TableCell className="font-medium">{t.shift}</TableCell>
                      <TableCell className="text-right font-figure text-xs tabular-nums">{t.people}</TableCell>
                      <TableCell className="text-right font-figure text-xs tabular-nums">{t.overtimeHours.toFixed(2)} h</TableCell>
                      <TableCell className="text-right font-figure text-xs tabular-nums">{t.owedHours.toFixed(2)} h</TableCell>
                      <TableCell className="text-right font-figure text-xs tabular-nums">{t.payrollOtHours.toFixed(2)} h</TableCell>
                      <TableCell className="text-right font-figure text-xs tabular-nums">
                        {t.payrollEmpty ? <span className="text-muted-foreground">not comparable</span> : `${t.deltaHours.toFixed(2)} h`}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Overtime paid leads: it is the figure somebody is about to pay, and it was
            sitting second in a row of six identical boxes with "People" first. */}
        <FigureRow>
          <Figure
            lead
            label="Overtime paid"
            value={totals.overtimeHours.toFixed(2)}
            unit="h"
            tone="earned"
            hint="After each person's own shortfall is covered"
          />
          <Figure
            label="Hours deducted"
            value={totals.owedHours.toFixed(2)}
            unit="h"
            tone={totals.owedHours > 0 ? "owed" : "neutral"}
          />
          <Figure
            label="Left early"
            value={totals.earlyLeaveHours.toFixed(2)}
            unit="h"
            tone={totals.earlyLeaveHours > 0 ? "owed" : "neutral"}
          />
          <Figure label="Payroll OT" value={totals.payrollOtHours.toFixed(2)} unit="h" />
          <Figure
            label="Gap to settle"
            // Nothing keyed means nothing to compare, and saying "0.00 h" would tell
            // somebody the two sides agree.
            value={totals.payrollEmpty ? "—" : totals.deltaHours.toFixed(2)}
            unit={totals.payrollEmpty ? undefined : "h"}
            hint={totals.payrollEmpty ? "Nothing keyed to compare" : undefined}
            tone={!totals.payrollEmpty && Math.abs(totals.deltaHours) >= 1 ? "owed" : "neutral"}
          />
          <Figure
            label="Shifts over rota"
            value={String(totals.overtimeShifts)}
            tone={totals.overtimeShifts > 0 ? "earned" : "neutral"}
            hint="From the board, not the clocks"
          />
          <Figure
            label="Shifts short"
            value={String(totals.deficitShifts)}
            tone={totals.deficitShifts > 0 ? "owed" : "neutral"}
            hint={totals.onUnplannedBoard > 0
              ? `${totals.onUnplannedBoard} have a rota but no board — nothing to measure`
              : undefined}
          />
          <Figure label="People" value={String(totals.people)} />
        </FigureRow>

        {/* Said before the table, not in a footnote: somebody is about to pay from
            this, and the two columns are not two halves of a total. */}
        <p className="flex items-start gap-1.5 rounded-md border border-warning/30 bg-warning/5 p-2.5 text-2xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning-strong" />
          <span>
            Hours are not settled week by week, and the balance <b>runs on between periods</b> — it is
            an hour bank. What somebody is up or down by at the close opens the next period, a
            shortfall is worked off against later hours one for one, and only what stands above zero
            at the close is overtime. Somebody 16 h down who works 12 h over is still 4 h short, not
            12 h to pay.
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
            ) : shown.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                Nothing recorded in this period. Overtime arrives from a TimeMoto import on the
                Attendance page, or from the office keying it into the overtime register.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    {/* A banded row above the column names, because this row carries
                        two answers that must never be added: the board says whether
                        somebody turned up, the clocks say how long they stayed.
                        Somebody who works every shift and goes home at two is level
                        under SHIFTS and short under HOURS, and without the band a
                        reader has fifteen columns and no way to tell which question
                        any of them answered. */}
                    <TableRow className="hover:bg-transparent">
                      <TableHead colSpan={3} />
                      <TableHead
                        colSpan={3}
                        className="border-l text-center text-2xs font-bold uppercase tracking-widest text-muted-foreground"
                      >
                        Shifts · from the board
                      </TableHead>
                      <TableHead
                        colSpan={5}
                        className="border-l text-center text-2xs font-bold uppercase tracking-widest text-muted-foreground"
                      >
                        Hours · from the clocks
                      </TableHead>
                      <TableHead
                        colSpan={5}
                        className="border-l text-center text-2xs font-bold uppercase tracking-widest text-muted-foreground"
                      >
                        Days away
                      </TableHead>
                    </TableRow>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Shift</TableHead>
                      <TableHead>Department</TableHead>
                      <TableHead className="border-l text-right">Due</TableHead>
                      <TableHead className="text-right">Worked</TableHead>
                      <TableHead className="text-right">+/−</TableHead>
                      <TableHead className="border-l text-right">Opening bank</TableHead>
                      <TableHead className="text-right">Period</TableHead>
                      <TableHead className="text-right">Closing bank</TableHead>
                      <TableHead className="text-right">Overtime</TableHead>
                      <TableHead className="text-right">Deducted</TableHead>
                      <TableHead className="text-right">Payroll OT</TableHead>
                      <TableHead className="text-right">Δ</TableHead>
                      <TableHead className="text-right">Present</TableHead>
                      <TableHead className="text-right">Sick</TableHead>
                      <TableHead className="text-right">Holiday</TableHead>
                      <TableHead className="text-right">Unpaid</TableHead>
                      <TableHead className="text-right">Left early (h)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shown.map((r) => (
                      <TableRow key={r.employeeId}>
                        <TableCell className="font-medium">{r.name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.shift ?? "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.department ?? "—"}</TableCell>

                        {/* Shifts. Whole numbers, so no decimals — a half shift is not
                            a thing the board can record. */}
                        <TableCell className="border-l text-right font-figure tabular-nums text-muted-foreground">
                          {r.shiftsDue ?? "—"}
                        </TableCell>
                        <TableCell className="text-right font-figure tabular-nums">{r.shiftsWorked}</TableCell>
                        <TableCell
                          className={`text-right font-figure font-semibold tabular-nums ${
                            r.shiftBalance == null ? "text-muted-foreground"
                              : r.shiftBalance > 0 ? "text-success-strong"
                              : r.shiftBalance < 0 ? "text-warning-strong" : ""}`}
                          // Shifts due is counted only over days somebody filled the
                          // board in, so a gap in the board cannot read as an absence.
                          // Said out loud when the board covers none of their days.
                          title={r.plannedDates?.size === 0
                            ? "This board was not planned on any day of the period — nothing to measure against"
                            : undefined}
                        >
                          {r.shiftBalance == null ? "—"
                            : `${r.shiftBalance > 0 ? "+" : ""}${r.shiftBalance}`}
                        </TableCell>

                        <TableCell className={`border-l text-right font-figure tabular-nums ${
                          r.openingHours < 0 ? "text-warning-strong" : "text-muted-foreground"}`}>
                          {r.openingHours.toFixed(2)}
                        </TableCell>
                        <TableCell className={`text-right font-figure tabular-nums ${
                          (r.clockedOtHours ?? 0) < 0 ? "text-destructive-strong" : ""}`}>
                          {num(r.clockedOtHours)}
                        </TableCell>
                        <TableCell className={`text-right font-figure font-semibold tabular-nums ${
                          (r.closingHours ?? 0) < 0 ? "text-destructive-strong" : ""}`}>
                          {num(r.closingHours)}
                        </TableCell>
                        <TableCell className="text-right font-figure font-semibold tabular-nums">
                          {num(r.overtimeHours)}
                        </TableCell>
                        <TableCell className={`text-right font-figure tabular-nums ${
                          (r.owedHours ?? 0) > 0 ? "text-warning-strong" : "text-muted-foreground"}`}>
                          {r.owedHours ? r.owedHours.toFixed(2) : "—"}
                        </TableCell>
                        <TableCell className="text-right font-figure tabular-nums">{num(r.payrollOtHours)}</TableCell>
                        <TableCell className={`text-right font-figure font-semibold tabular-nums ${
                          r.deltaHours == null ? "text-muted-foreground"
                            : Math.abs(r.deltaHours) >= 1 ? "text-destructive-strong" : ""}`}>
                          {num(r.deltaHours)}
                        </TableCell>
                        <TableCell className="text-right font-figure tabular-nums">{r.daysPresent}</TableCell>
                        <TableCell className="text-right font-figure tabular-nums">{r.sick || "—"}</TableCell>
                        <TableCell className="text-right font-figure tabular-nums">{r.holiday || "—"}</TableCell>
                        <TableCell className="text-right font-figure tabular-nums">{r.unpaid || "—"}</TableCell>
                        {/* Hours, where every column beside it is days — a day cut
                            short is not a day off, and rounding it to one would say
                            Elias Soares had a whole day away when he worked two hours
                            of it. */}
                        <TableCell className={`text-right font-figure tabular-nums ${
                          r.earlyLeaveHours > 0 ? "text-warning-strong" : "text-muted-foreground"}`}>
                          {r.earlyLeaveHours ? r.earlyLeaveHours.toFixed(2) : "—"}
                        </TableCell>
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
            activePeriod={period}
          />
        </div>
      </div>
      </AdminPinGate>
    </DashboardLayout>
  );
}
