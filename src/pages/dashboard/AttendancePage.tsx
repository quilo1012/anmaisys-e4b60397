import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { BackButton } from "@/components/BackButton";
import { WorkforceTabs } from "@/components/workforce/WorkforceTabs";
import { ModuleHeader } from "@/components/ui/ModuleHeader";
import { Figure, FigureRow } from "@/components/ui/Figure";
import { AdminPinGate } from "@/components/AdminPinGate";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Clock, Upload, Loader2, AlertTriangle, CalendarClock, Printer } from "lucide-react";
import { useRole } from "@/hooks/useRole";
import { MonthlySummary } from "@/components/workforce/MonthlySummary";
import { useEmployees } from "@/hooks/useWorkforce";
import { parseTimeMotoWorkbook, matchNames, type TimeMotoParse } from "@/lib/timeMotoSheet";
import { splitAbsences } from "@/lib/absenceKind";

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** `13/07/2026`. The factory reads dates day-first, and a printed sheet is read here. */
const fmtDate = (d: string) => (d ? d.split("-").reverse().join("/") : "—");

/** `7h 30m`, `−1h 15m`, or a dash. Signed, because a balance that loses its sign is a lie. */
function hm(mins: number | null | undefined): string {
  if (mins == null) return "—";
  const neg = mins < 0;
  const a = Math.abs(mins);
  const s = a < 60 ? `${a}m` : `${Math.floor(a / 60)}h ${String(a % 60).padStart(2, "0")}m`;
  return neg ? `−${s}` : s;
}

/**
 * Where the name→employee choices live between imports.
 *
 * The browser, not the database: it is a reading aid for whoever runs the import, not
 * a fact about the payroll, and it is re-shown for approval every time.
 */
const ASSIGNED_KEY = "timemoto-name-assignments";

function readAssigned(): Record<string, string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(ASSIGNED_KEY) ?? "null");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(([, v]) => typeof v === "string"),
    ) as Record<string, string>;
  } catch {
    return {};
  }
}

function writeAssigned(v: Record<string, string>) {
  // A private window that refuses storage must not sink an import that otherwise worked.
  try { localStorage.setItem(ASSIGNED_KEY, JSON.stringify(v)); } catch { /* not worth a toast */ }
}

/**
 * Time & attendance, from the clocks rather than from the board.
 *
 * The headcount board says who was *meant* to be on a line. TimeMoto says who
 * actually badged in. They are different questions and the gap between them is the
 * one nobody could see: somebody rostered who never clocked on.
 */
export default function AttendancePage() {
  const qc = useQueryClient();
  // Everybody, leavers included — the monthly view covers days already worked.
  const { data: allEmployees } = useEmployees();
  const { can } = useRole();
  const canManage = can("workforce.manage");

  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const [from, setFrom] = useState(iso(monthStart));
  const [to, setTo] = useState(iso(today));
  const [periodTouched, setPeriodTouched] = useState(false);

  /**
   * Opens on the pay period, not on the calendar month.
   *
   * It opened on the 1st to today — four days on 04/08 — while the finance close
   * covered 13/07 to 09/08. The same two figures read 497h and 3,359h, and a balance
   * of −321h beside one of −345h, which looks like two screens disagreeing when it
   * is one question asked of two different fortnights.
   */
  useQuery({
    queryKey: ["attendance-default-period"],
    queryFn: async () => {
      const d = iso(new Date());
      const { data } = await (supabase as any)
        .from("workforce_payroll_periods")
        .select("start_date, end_date")
        .lte("start_date", d).gte("end_date", d)
        .limit(1).maybeSingle();
      // Never overrides a range somebody has chosen.
      if (data && !periodTouched) { setFrom(data.start_date); setTo(data.end_date); }
      return data ?? null;
    },
  });

  const [preview, setPreview] = useState<TimeMotoParse | null>(null);
  /**
   * Which employee a name in the sheet means, when the sheet cannot say.
   *
   * Keyed by the name as TimeMoto spells it. Seeded from the last import so the
   * weekly file does not ask the same question every Monday, and always shown in the
   * preview before anything is written — a remembered choice that decides silently is
   * worse than the question.
   */
  const [assigned, setAssigned] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: roster = [] } = useQuery({
    queryKey: ["attendance-roster"],
    queryFn: async () => {
      const { data, error } = await supabase.from("employees").select("id, full_name, department").eq("active", true);
      if (error) throw error;
      return (data ?? []) as { id: string; full_name: string; department: string | null }[];
    },
  });

  const { data: days = [], isLoading } = useQuery({
    queryKey: ["attendance-days", from, to],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("attendance_days")
        .select("employee_id, on_date, worked_minutes, balance_minutes, absence_name")
        .gte("on_date", from).lte("on_date", to);
      if (error) throw error;
      return (data ?? []) as { employee_id: string; on_date: string; worked_minutes: number | null; balance_minutes: number | null; absence_name: string | null }[];
    },
  });

  /** The picker's fallback list, in the order a person would look for a name. */
  const rosterByName = useMemo(
    () => [...roster].sort((a, b) => a.full_name.localeCompare(b.full_name)),
    [roster],
  );

  const nameById = useMemo(() => new Map(roster.map((e) => [e.id, e.full_name])), [roster]);
  // Already fetched and never read. A sheet of a hundred and seventy-six names is
  // handed to somebody who supervises one department, and without it they have to know
  // every name in the factory to find their own dozen.
  const deptById = useMemo(() => new Map(roster.map((e) => [e.id, e.department])), [roster]);

  const byPerson = useMemo(() => {
    const m = new Map<string, { worked: number; balance: number; present: number; absences: Record<string, number> }>();
    for (const d of days) {
      const cur = m.get(d.employee_id) ?? { worked: 0, balance: 0, present: 0, absences: {} };
      cur.worked += d.worked_minutes ?? 0;
      cur.balance += d.balance_minutes ?? 0;
      if (d.absence_name) cur.absences[d.absence_name] = (cur.absences[d.absence_name] ?? 0) + 1;
      else if ((d.worked_minutes ?? 0) > 0) cur.present += 1;
      m.set(d.employee_id, cur);
    }
    return [...m.entries()]
      .map(([id, v]) => {
        // Booked holiday is not an absence. It was asked for, granted and paid, and it
        // comes off an entitlement that has a balance — so it is counted, like the days
        // present beside it. What is left is the unplanned time, which is read for its
        // reason rather than its total.
        const split = splitAbsences(v.absences);
        return {
          id, name: nameById.get(id) ?? "Unknown", department: deptById.get(id) ?? null, ...v,
          holiday: split.holiday,
          unplanned: split.unplanned,
          unplannedDays: split.sick + split.unpaid + split.other,
        };
      })
      .sort((a, b) => b.worked - a.worked);
  }, [days, nameById, deptById]);

  const totals = useMemo(() => ({
    worked: byPerson.reduce((a, p) => a + p.worked, 0),
    balance: byPerson.reduce((a, p) => a + p.balance, 0),
    people: byPerson.length,
    // Summed off the same split the rows are drawn from, not counted again off the raw
    // days. Counting twice is how a header and the column under it start disagreeing.
    holidayDays: byPerson.reduce((a, p) => a + p.holiday, 0),
    absenceDays: byPerson.reduce((a, p) => a + p.unplannedDays, 0),
  }), [byPerson]);

  /**
   * Who each name in the sheet is, recomputed as the choices are made.
   *
   * Derived rather than stored, so picking a person in the dialog moves the name out
   * of the unsettled list and into the count in the same breath.
   */
  const match = useMemo(
    () => (preview ? matchNames(preview.names, roster, assigned) : { matched: [], unmatched: [] }),
    [preview, roster, assigned],
  );

  /**
   * The names this import had to be told about — the ones it cannot settle, and the
   * ones a person settled for it.
   *
   * A remembered choice that quietly resolves a name is the same silent guess this
   * whole screen refuses to make, so it stays on show, with the person it points at
   * and the picker still live to change it.
   */
  const toSettle = useMemo(() => {
    if (!preview) return [];
    const unsettled = new Map(match.unmatched.map((u) => [u.name, u]));
    return preview.names
      .filter((n) => unsettled.has(n) || assigned[n])
      .map((n) => unsettled.get(n) ?? { name: n, reason: "chosen" as const, candidates: [] });
  }, [preview, match.unmatched, assigned]);

  const readFile = async (file: File) => {
    setBusy(true);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const parsed = parseTimeMotoWorkbook(wb, today.getFullYear());
      setAssigned(readAssigned());
      setPreview(parsed);
    } catch (e) {
      toast.error(`Could not read the file: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const idOf = new Map(match.matched.map((m) => [m.name, m.employeeId]));
      const rows = preview.rows
        .filter((r) => idOf.has(r.name))
        .map((r) => ({
          employee_id: idOf.get(r.name)!,
          on_date: r.date,
          start_time: r.start,
          end_time: r.end,
          worked_minutes: r.workedMinutes,
          balance_minutes: r.balanceMinutes,
          absence_name: r.absence,
          // The table has had these two columns since it was created and the first
          // version of this import left them null: what the contract said the day
          // should be, and any correction the office made by hand.
          scheduled_minutes: r.scheduledMinutes,
          overtime_adj_minutes: r.overtimeAdjMinutes,
          remarks: r.remarks,
          source: "timemoto",
        }));
      if (rows.length === 0) { toast.error("Nothing to import — no name in the file is settled on somebody"); return; }
      const { error } = await (supabase as any)
        .from("attendance_days")
        .upsert(rows, { onConflict: "on_date,employee_id" });
      if (error) throw error;
      // Remembered only once the import went through, so a choice made for a file that
      // then failed to write does not come back pre-approved next week.
      writeAssigned(assigned);
      toast.success(`Imported ${rows.length} day${rows.length === 1 ? "" : "s"}`);
      if (preview.from) setFrom(preview.from);
      if (preview.to) setTo(preview.to);
      qc.invalidateQueries({ queryKey: ["attendance-days"] });
      setPreview(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <DashboardLayout>
      <AdminPinGate
        storageKey="workforce"
        title="Time &amp; Attendance"
        description="Hours, balances and absence reasons for every employee. Enter the admin PIN to open."
      >
      {/* `print-content` is what the global print sheet hangs its rules off; without it
          the table keeps its screen scroll container and the right-hand columns simply
          do not come out on paper. `print-landscape` turns the sheet: seven columns of
          names, hours and reasons is wider than portrait can hold without splitting a
          person's row across two pages. */}
      <div className="space-y-4 print-content print-landscape">
        <BackButton className="no-print" />
        <div className="no-print"><WorkforceTabs /></div>

        <ModuleHeader
          title="Time &amp; Attendance"
          // The period, on the band, because the band is the only part of this screen
          // that survives onto paper — and a sheet of hours with no dates on it is a
          // sheet nobody can file or check.
          description={`Hours clocked, from TimeMoto · ${fmtDate(from)} → ${fmtDate(to)}`}
          // Every `<header>` is hidden in print. This one carries the title and the
          // period, which is what makes the printout a document rather than a grid.
          className="print-keep"
        >
          <Button size="sm" variant="secondary" onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" /> Print
          </Button>
          {canManage && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); e.target.value = ""; }}
              />
              <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()} disabled={busy}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                Import TimeMoto
              </Button>
            </>
          )}
        </ModuleHeader>

        {/* Two records of the same days, kept apart. The clocks are what TimeMoto
            saw; the board marks are what a supervisor wrote down. Merging them would
            hide which one a number came from, and right now the clocks are empty
            while the board is not. */}
        <Tabs defaultValue="clocks" className="space-y-4">
          {/* The tab strip is a control, and on paper a control is a row of grey boxes
              saying which one you could have pressed. Which record this IS gets said in
              the band above instead. */}
          <TabsList className="no-print">
            <TabsTrigger value="clocks">Clocks (TimeMoto)</TabsTrigger>
            <TabsTrigger value="marks">Board marks</TabsTrigger>
          </TabsList>

          <TabsContent value="clocks" className="space-y-4">
        {/* The dates chosen here are printed in the band, so the pickers themselves are
            two empty boxes on paper. */}
        <div className="flex flex-wrap items-end gap-2 no-print">
          <div><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => { setPeriodTouched(true); setFrom(e.target.value); }} className="mt-1 h-8 w-40" /></div>
          <div><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => { setPeriodTouched(true); setTo(e.target.value); }} className="mt-1 h-8 w-40" /></div>
        </div>

        {/* Hours worked leads: this screen exists to say what the clocks recorded, and
            the other three are how to read that number. */}
        <FigureRow>
          <Figure lead label="Hours worked" value={hm(totals.worked)} hint="What TimeMoto recorded" />
          <Figure
            label="Balance"
            value={hm(totals.balance)}
            // The one figure on this screen that carries a sign, so it is the one that
            // gets the rule: above the line is worked, below it is owed.
            tone={totals.balance > 0 ? "earned" : totals.balance < 0 ? "owed" : "neutral"}
          />
          <Figure label="People clocked" value={String(totals.people)} />
          <Figure label="Holiday days" value={String(totals.holidayDays)} />
          <Figure
            label="Absence days"
            value={String(totals.absenceDays)}
            // The hint is here and not on the holiday figure because this is the number
            // that changed meaning: it used to include holiday, and read as absenteeism
            // that a shift could act on when most of it was booked leave.
            hint="Sick, unpaid or unexplained"
          />
        </FigureRow>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6 text-center text-sm text-muted-foreground">Loading…</div>
            ) : byPerson.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                Nothing clocked in this period. Import a TimeMoto timesheet to fill it.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    {/* A banded row over the column names, because the six figures under
                        it answer two questions that must not be added: how LONG somebody
                        was here, and how many DAYS they were or were not. Somebody who
                        clocks every day and leaves at two is whole on days and short on
                        hours, and without the band a reader has six columns and no way
                        to tell which question any of them answered. */}
                    <TableRow className="hover:bg-transparent">
                      <TableHead colSpan={2} />
                      <TableHead
                        colSpan={2}
                        className="border-l text-center text-2xs font-bold uppercase tracking-widest text-muted-foreground"
                      >
                        Hours
                      </TableHead>
                      <TableHead
                        colSpan={3}
                        className="border-l text-center text-2xs font-bold uppercase tracking-widest text-muted-foreground"
                      >
                        Days
                      </TableHead>
                    </TableRow>
                    {/* Widths on the figures, none on the words. Six unsized columns
                        spread evenly across a 1900px window, so a name sat at the far
                        left and its hours at the far right with a hand's width of white
                        between them — a row nobody could read across without a finger on
                        the screen. Fixed here, the digits line up in a column and the
                        slack goes to the reason column, which is the one that varies. */}
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead className="w-[9rem]">Department</TableHead>
                      <TableHead className="w-[6.5rem] border-l text-right">Worked</TableHead>
                      <TableHead className="w-[6.5rem] text-right">Balance</TableHead>
                      <TableHead className="w-[5rem] border-l text-right">Present</TableHead>
                      <TableHead className="w-[5rem] text-right">Holiday</TableHead>
                      <TableHead className="w-[13rem]">Absence</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {byPerson.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {p.department ?? "—"}
                        </TableCell>
                        <TableCell className="border-l text-right font-figure tabular-nums">{hm(p.worked)}</TableCell>
                        <TableCell className={`text-right font-figure tabular-nums ${p.balance < 0 ? "text-destructive-strong" : p.balance > 0 ? "text-success-strong" : ""}`}>
                          {hm(p.balance)}
                        </TableCell>
                        <TableCell className="border-l text-right font-figure tabular-nums">{p.present}</TableCell>
                        {/* A count, set like the days present next to it, because that is
                            what a holiday is: days off an entitlement. A dash where there
                            are none, so the column shows at a glance who was away. */}
                        <TableCell className="text-right font-figure tabular-nums">
                          {p.holiday === 0 ? <span className="text-muted-foreground">—</span> : p.holiday}
                        </TableCell>
                        {/* Names rather than a number: on an unplanned day the reason is
                            the thing being read. "Sickness ×1" and "Unpaid Leave ×1" are
                            two different conversations. */}
                        <TableCell className="text-2xs">
                          {Object.keys(p.unplanned).length === 0
                            ? <span className="text-muted-foreground">—</span>
                            : Object.entries(p.unplanned).map(([k, n]) => `${k} ×${n}`).join(" · ")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
          </TabsContent>

          <TabsContent value="marks">
            {/* Was the Workforce screen's Attendance tab. It reads `employee_attendance`
                — the statuses marked on the headcount board — which no other screen
                shows month by month. */}
            <MonthlySummary employees={allEmployees ?? []} />
          </TabsContent>
        </Tabs>

        <Dialog open={preview !== null} onOpenChange={(v) => !v && setPreview(null)}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Import TimeMoto timesheet</DialogTitle>
              <DialogDescription>Nothing is saved until you confirm.</DialogDescription>
            </DialogHeader>
            {preview && (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">{preview.rows.length} rows</Badge>
                  <Badge variant="outline">{match.matched.length} of {preview.names.length} people matched</Badge>
                  {preview.from && <Badge variant="outline">{preview.from} → {preview.to}</Badge>}
                </div>

                {/* The columns it read, because a parser that guessed wrong imports a
                    thousand rows of confident nonsense and this is where that shows. */}
                <div className="rounded-md border p-2.5 text-2xs">
                  <div className="font-semibold">Columns read</div>
                  <div className="text-muted-foreground">
                    {Object.entries(preview.columns).map(([label, field]) => `${label} → ${field}`).join(" · ") || "none"}
                  </div>
                  {preview.ignoredColumns.length > 0 && (
                    <div className="mt-1 text-muted-foreground">Ignored: {preview.ignoredColumns.join(", ")}</div>
                  )}
                </div>

                {/* An export for one person carries a Firstname and no surname, so
                    "Daniel" is all the sheet knows and two Daniels are on the payroll.
                    Refusing was right; refusing and calling it a name nobody answers to
                    sent the office away from an import that only needed one answer. */}
                {toSettle.length > 0 && (
                  <div className="max-h-56 space-y-2 overflow-y-auto rounded-md border p-2.5 text-2xs">
                    <div className="font-semibold">Who does the sheet mean?</div>
                    {toSettle.map((u) => (
                      <div key={u.name} className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-semibold">{u.name}</div>
                          <div className="text-muted-foreground">
                            {u.reason === "chosen"
                              ? "Chosen by hand, remembered from the last import"
                              : u.reason === "ambiguous"
                                ? `${u.candidates.length} people answer to this`
                                : "Nobody on the payroll answers to this"}
                          </div>
                        </div>
                        <Select
                          value={assigned[u.name] ?? "__none"}
                          onValueChange={(v) =>
                            setAssigned((prev) => {
                              const next = { ...prev };
                              if (v === "__none") delete next[u.name];
                              else next[u.name] = v;
                              return next;
                            })
                          }
                        >
                          <SelectTrigger className="h-8 w-48 text-xs"><SelectValue placeholder="Leave out…" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none">— leave this name out —</SelectItem>
                            {/* The people who actually answer to the name first: on a
                                payroll of a hundred and seventy-six, a flat list is a
                                scroll, and the two candidates are the whole question. */}
                            {u.candidates.map((c) => (
                              <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>
                            ))}
                            {rosterByName
                              .filter((e) => !u.candidates.some((c) => c.id === e.id))
                              .map((e) => (
                                <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                    <div className="text-muted-foreground">
                      A name left out imports nothing. What you choose is remembered for the next
                      import — read it before importing, because another person's sheet can spell
                      their name exactly the same way.
                    </div>
                  </div>
                )}

                {preview.skipped.length > 0 && (
                  <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-md border border-warning/30 bg-warning/5 p-2.5 text-2xs">
                    <div className="flex items-center gap-1.5 font-semibold text-warning-strong">
                      <AlertTriangle className="h-3.5 w-3.5" /> Not imported
                    </div>
                    {preview.skipped.length > 0 && (
                      <div>
                        <div className="font-semibold">{preview.skipped.length} row(s) skipped</div>
                        <div className="text-muted-foreground">
                          {preview.skipped.slice(0, 6).map((s) => `line ${s.row}: ${s.reason}`).join(" · ")}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => setPreview(null)}>Cancel</Button>
                  <Button className="flex-1" onClick={commit} disabled={busy || !canManage || match.matched.length === 0}>
                    {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Import
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        <p className="flex items-start gap-1.5 text-2xs text-muted-foreground">
          <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          The headcount board says who was meant to be on a line; this says who actually
          clocked on. Importing the same period twice updates those days rather than
          duplicating them.
        </p>
      </div>
      </AdminPinGate>
    </DashboardLayout>
  );
}
