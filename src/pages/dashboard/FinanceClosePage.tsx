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
import { Calculator, Download, Printer, AlertTriangle, FileText, FileSpreadsheet, FileDown } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { downloadCsv } from "@/lib/exportCsv";
import { exportClosePdf, exportCloseExcel, type CloseExportInput } from "@/lib/financeCloseExports";
import { CLOSE_COLUMNS, closeBandSpans } from "@/lib/financeCloseColumns";
import { OvertimePanel } from "@/components/workforce/OvertimePanel";
import { useEmployees, useOvertimeEntries } from "@/hooks/useWorkforce";
import { boardShiftFor } from "@/hooks/useHeadcount";
import {
  buildClose, closeTotals, closeToCsvRows, CLOSE_HEADERS, round2,
  closeCrews, filterByCrew, crewLabel, NO_CREW,
  closeDepartments, departmentLabel, filterClose, NO_DEPARTMENT,
  type ClosePersonInput,
} from "@/lib/financeClose";
import { partDay } from "@/lib/partDay";
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
        // Days somebody came in for and was only there for part of — in late, home
        // early, or both. Nothing has ever counted these: the board stored the time and
        // every screen still recorded a full day.
        // The whole board for the period, not just the early leavers. It answers the
        // other question — how many shifts were they due and how many did they come to
        // — which used to be a second table underneath this one, over the same people
        // and the same dates. Paged: this period holds 1524 rows and PostgREST returns
        // a thousand without a word.
        fetchAllRows<any>({
          range: (a, b) => db.from("daily_allocations")
            .select("employee_id, on_date, status, shift, left_early_at, arrived_late_at")
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
        // The crew and the board are two different answers and this used to ask for
        // one of them twice.
        //
        // `boardShiftFor` folds the five crews onto the two wall charts the factory
        // plans, so Weekend, Warehouse Day and Warehouse Weekend all came back "Day":
        // fifty-eight people inside a subtotal of seventy-seven, and no filter that
        // could ask for any of them. The close groups by CREW — it is what says which
        // days somebody was due in.
        //
        // The board is still what `plannedDates` has to be read from. `daily_
        // allocations.shift` only ever holds Day and Night, so looking that up by crew
        // would find nothing for the Fri–Mon crew and hand all forty of them an empty
        // set — every one of them reading as a full period over their rota.
        const crew = (e.shift_group as string | null) ?? null;
        const board = boardShiftFor(e.shift_group);
        byId.set(e.id, {
          employeeId: e.id, name: e.full_name, department: e.department ?? null,
          shift: crew,
          openingBalanceMin: null, clockedBalanceMin: null,
          payrollOtHours: null, absences: {}, daysPresent: 0,
          partDayHours: 0,
          patternName: e.shift_patterns?.name ?? null,
          patternDays: e.shift_patterns?.days ?? null,
          shiftsWorked: 0, shiftsHoliday: 0,
          plannedDates: plannedByShift.get(board ?? "Day") ?? new Set<string>(),
        });
      }

      // The rota is what says how long the shift was, so a person with none on file
      // contributes nothing to the part-day figure rather than a guessed shortfall.
      const rotaById = new Map(((rotas.data ?? []) as any[]).map((p) => [p.id, p]));
      const patternOf = new Map(
        ((emp.data ?? []) as any[]).map((e) => [e.id, rotaById.get(e.shift_pattern_id)]),
      );

      // One pass over the board for both answers it holds: shifts turned up for, and
      // hours of a shift somebody came in for and was not there for.
      for (const a of (board.data ?? []) as any[]) {
        const p = byId.get(a.employee_id); if (!p) continue;
        if (a.status === "assigned" || a.status === "overtime") p.shiftsWorked += 1;
        else if (a.status === "holiday") p.shiftsHoliday += 1;

        if (!a.left_early_at && !a.arrived_late_at) continue;
        const rota = patternOf.get(a.employee_id);
        if (!rota) continue;
        // The two ends of the day read together, not summed. A person in at nine and
        // home at two was there for one window, and two separate shortfalls added up
        // would take the break off both halves of a break they had once.
        const cut = partDay({ arrivedLateAt: a.arrived_late_at, leftEarlyAt: a.left_early_at }, {
          startsAt: rota.starts_at, endsAt: rota.ends_at, breakMinutes: rota.break_minutes,
        });
        if (cut) p.partDayHours = round2(p.partDayHours + cut.missedHours);
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
            || p.partDayHours > 0
            || p.shiftsWorked > 0 || p.shiftsHoliday > 0
            || !!p.patternDays?.length,
        ),
        from, to,
      );
    },
  });

  /**
   * One crew, or the whole factory.
   *
   * The night crew is sixty people on a rota of its own and the Fri–Mon crew is forty
   * more; their overtime behaves nothing like the Mon–Thu crews' — reading one figure
   * for the whole factory hid which side of it the hours were on. This offered two
   * choices and the factory has five crews, so three of them had no view at all.
   *
   * "Everybody" is the default because the close is a whole-factory document; the
   * subtotals add up to it exactly, since a person belongs to one crew.
   */
  const [shiftFilter, setShiftFilter] = useState<string>("all");

  /**
   * And one department, which is the other half of the question people actually ask.
   *
   * "Production weekend" is not a crew. The Weekend crew is forty people and thirty-one
   * of them are on the lines; the rest are Hygiene, Lab and Office working the same
   * days. Asked for by crew alone, a question about thirty-one came back as a subtotal
   * of forty.
   *
   * A second select rather than a "Production Weekend" entry in the first: composed,
   * the same two answer Production Night and Hygiene Weekend too, and the crew list
   * stays a list of crews.
   */
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const departments = useMemo(() => closeDepartments(rows), [rows]);
  // Departments are read off the WHOLE period, not off the chosen crew: narrowing both
  // ways round would make each select rewrite the other's options as you used them.
  const department = deptFilter !== "all" && !departments.includes(deptFilter) ? "all" : deptFilter;

  // The crews are read off the chosen department, so picking Warehouse does not leave
  // Night in the list offering a view of nobody.
  const inDept = useMemo(
    () => filterClose(rows, { crew: "all", department }),
    [rows, department],
  );
  const crews = useMemo(() => closeCrews(inDept), [inDept]);
  // A crew that emptied when the period or the department changed must not leave the
  // page showing nothing with a filter nobody can see the effect of.
  const crew = shiftFilter !== "all" && !crews.includes(shiftFilter) ? "all" : shiftFilter;
  const shown = useMemo(
    () => filterClose(rows, { crew, department }),
    [rows, crew, department],
  );

  const totals = useMemo(() => closeTotals(shown), [shown]);
  /**
   * Every crew side by side, so the split is readable without touching the filter.
   * Within the chosen department, so the subtotals still add up to the table below.
   */
  const byShift = useMemo(
    () => crews.map((s) => ({ shift: s, ...closeTotals(filterByCrew(inDept, s)) }))
      .filter((t) => t.people > 0),
    [inDept, crews],
  );

  /** What the page is showing, said out loud — it is printed and handed to somebody. */
  const scope = [
    department === "all" ? null : departmentLabel(department),
    crew === "all" ? null : crewLabel(crew),
  ].filter(Boolean).join(" · ");

  /**
   * The filter goes in the filename, whatever the format.
   *
   * A close of thirty-one people and a close of a hundred and seventy-six are the same
   * file otherwise, and the one that lands in payroll's inbox is whichever was
   * downloaded second.
   */
  const fileBase = `finance-close-${period?.name?.replace(/\s+/g, "-").toLowerCase() ?? from}${
    scope ? `-${scope.replace(/\W+/g, "-").toLowerCase()}` : ""}`;

  /** Everything the PDF and the workbook need, built once for both. */
  const exportInput = (): CloseExportInput => ({
    periodName: period?.name ?? "No period",
    from, to, scope,
    rows: shown,
    totals,
    byCrew: byShift.map((t) => ({ crew: crewLabel(t.shift), totals: t })),
    fileBase,
  });

  /**
   * The register below, narrowed to the same crew.
   *
   * Filtered on the ENTRY's employee, not by handing the panel a shorter employee
   * list: the panel builds its rows from the entries and looks each name up, so a
   * shortened list would have turned the other crews' rows into "Employee no longer on
   * file" instead of hiding them.
   */
  const otShown = useMemo(() => {
    if (crew === "all" && department === "all") return otEntries ?? [];
    const byId = new Map((otEmployees ?? []).map((e) => [e.id, {
      crew: e.shift_group ?? NO_CREW,
      department: (e.department ?? "").trim() || NO_DEPARTMENT,
    }]));
    return (otEntries ?? []).filter((e) => {
      const who = byId.get(e.employee_id);
      // Keyed against somebody no longer on file: there is no crew or department to
      // match, so they only appear under the unfiltered view. Which is where anybody
      // reconciling the register will be looking for them.
      if (!who) return false;
      return (crew === "all" || who.crew === crew)
        && (department === "all" || who.department === department);
    });
  }, [otEntries, otEmployees, crew, department]);
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
          description={period
            ? `${period.name} · ${from} → ${to}${scope ? ` · ${scope} only` : ""}`
            : "No pay period set"}
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
          {/* Department first, crew second — it is the order the question is asked in
              ("production weekend"), and the department is what narrows the crew list
              rather than the other way round. */}
          <Select value={department} onValueChange={setDeptFilter}>
            <SelectTrigger className="h-9 w-[190px] border-white/25 bg-white/10 text-white"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Every department</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d} value={d}>{departmentLabel(d)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={crew} onValueChange={setShiftFilter}>
            <SelectTrigger className="h-9 w-[190px] border-white/25 bg-white/10 text-white"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Every crew</SelectItem>
              {crews.map((c) => (
                <SelectItem key={c} value={c}>{crewLabel(c)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="secondary" className="print:hidden" onClick={() => window.print()}>
            <Printer className="mr-1.5 h-4 w-4" /> Print
          </Button>
          {/* Three formats for three jobs, behind one button. The PDF is the sheet you
              hand somebody, the workbook is the one payroll sums, and the CSV is what
              feeds another system. They were one CSV, and the print button was the only
              way to get a readable page out of an eighteen-column table. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="secondary" className="print:hidden" disabled={shown.length === 0}>
                <Download className="mr-1.5 h-4 w-4" /> Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {/* Caught, because building a PDF is async and a rejected promise here
                  would be a click that does nothing and says nothing — on the one
                  screen where "no file arrived" is indistinguishable from "the period
                  is empty". */}
              <DropdownMenuItem onSelect={() => {
                exportClosePdf(exportInput()).catch((e) => {
                  toast.error("The PDF could not be built.", { description: String(e?.message ?? e) });
                });
              }}>
                <FileText className="mr-2 h-4 w-4" /> PDF · to hand over
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => {
                try { exportCloseExcel(exportInput()); } catch (e: any) {
                  toast.error("The workbook could not be built.", { description: String(e?.message ?? e) });
                }
              }}>
                <FileSpreadsheet className="mr-2 h-4 w-4" /> Excel · to add up
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => downloadCsv(
                `${fileBase}.csv`, CLOSE_HEADERS, closeToCsvRows(shown),
              )}>
                <FileDown className="mr-2 h-4 w-4" /> CSV · to feed another system
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
                      className={crew === t.shift ? "bg-muted/50" : undefined}
                    >
                      <TableCell className="font-medium">{crewLabel(t.shift)}</TableCell>
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
            label="Part day"
            value={totals.partDayHours.toFixed(2)}
            unit="h"
            tone={totals.partDayHours > 0 ? "owed" : "neutral"}
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
              // An empty filter and an empty period are different facts, and the period
              // message read as "the factory recorded nothing" when it meant "nobody in
              // Warehouse works nights".
              <div className="p-6 text-center text-sm text-muted-foreground">
                {scope
                  ? <>Nobody in <b>{scope}</b> in this period.</>
                  : <>Nothing recorded in this period. Overtime arrives from a TimeMoto import on the
                     Attendance page, or from the office keying it into the overtime register.</>}
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
                      {/* Counted off CLOSE_COLUMNS, not written by hand. Written by hand
                          they read 3 + 3 + 5 + 5 over a table of EIGHTEEN columns, so
                          everything past the tenth sat one band to the left: Payroll OT
                          and Δ were printed under "Days away" — hours labelled as days
                          of absence, on the sheet somebody is paid from — and the last
                          two columns had no band at all. */}
                      {closeBandSpans().map((b) => (
                        <TableHead
                          key={b.band}
                          colSpan={b.span}
                          className={b.label
                            ? "border-l text-center text-2xs font-bold uppercase tracking-widest text-muted-foreground"
                            : undefined}
                        >
                          {b.label}
                        </TableHead>
                      ))}
                    </TableRow>
                    {/* Same source as the band above it, so a column added to one can
                        never leave the other a cell short. */}
                    <TableRow>
                      {CLOSE_COLUMNS.map((c, i) => (
                        <TableHead
                          key={c.key}
                          className={[
                            c.align === "right" ? "text-right" : "",
                            // A rule where a band starts, so the eye can see the join.
                            i > 0 && CLOSE_COLUMNS[i - 1].band !== c.band ? "border-l" : "",
                          ].filter(Boolean).join(" ") || undefined}
                        >
                          {c.header}
                        </TableHead>
                      ))}
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
                        <TableCell className="border-l text-right font-figure tabular-nums">{r.daysPresent}</TableCell>
                        <TableCell className="text-right font-figure tabular-nums">{r.sick || "—"}</TableCell>
                        <TableCell className="text-right font-figure tabular-nums">{r.holiday || "—"}</TableCell>
                        <TableCell className="text-right font-figure tabular-nums">{r.unpaid || "—"}</TableCell>
                        {/* Hours, where every column beside it is days — a day cut
                            short is not a day off, and rounding it to one would say
                            Elias Soares had a whole day away when he worked two hours
                            of it. */}
                        <TableCell className={`border-l text-right font-figure tabular-nums ${
                          r.partDayHours > 0 ? "text-warning-strong" : "text-muted-foreground"}`}>
                          {r.partDayHours ? r.partDayHours.toFixed(2) : "—"}
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
            {scope && (
              <> Showing <b>{scope}</b> only, to match the filter above.</>
            )}
          </p>
          <OvertimePanel
            employees={otEmployees ?? []}
            entries={otShown}
            activePeriod={period}
          />
        </div>
      </div>
      </AdminPinGate>
    </DashboardLayout>
  );
}
