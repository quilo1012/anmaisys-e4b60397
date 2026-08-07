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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Clock, Upload, Loader2, AlertTriangle, CalendarClock } from "lucide-react";
import { useRole } from "@/hooks/useRole";
import { MonthlySummary } from "@/components/workforce/MonthlySummary";
import { useEmployees } from "@/hooks/useWorkforce";
import { parseTimeMotoWorkbook, matchNames, type TimeMotoParse } from "@/lib/timeMotoSheet";

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** `7h 30m`, `−1h 15m`, or a dash. Signed, because a balance that loses its sign is a lie. */
function hm(mins: number | null | undefined): string {
  if (mins == null) return "—";
  const neg = mins < 0;
  const a = Math.abs(mins);
  const s = a < 60 ? `${a}m` : `${Math.floor(a / 60)}h ${String(a % 60).padStart(2, "0")}m`;
  return neg ? `−${s}` : s;
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

  const [preview, setPreview] = useState<(TimeMotoParse & { matched: { name: string; employeeId: string }[]; unmatched: string[] }) | null>(null);
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

  const nameById = useMemo(() => new Map(roster.map((e) => [e.id, e.full_name])), [roster]);

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
      .map(([id, v]) => ({ id, name: nameById.get(id) ?? "Unknown", ...v }))
      .sort((a, b) => b.worked - a.worked);
  }, [days, nameById]);

  const totals = useMemo(() => ({
    worked: byPerson.reduce((a, p) => a + p.worked, 0),
    balance: byPerson.reduce((a, p) => a + p.balance, 0),
    people: byPerson.length,
    absenceDays: days.filter((d) => d.absence_name).length,
  }), [byPerson, days]);

  const readFile = async (file: File) => {
    setBusy(true);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const parsed = parseTimeMotoWorkbook(wb, today.getFullYear());
      const { matched, unmatched } = matchNames(parsed.names, roster);
      setPreview({ ...parsed, matched, unmatched });
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
      const idOf = new Map(preview.matched.map((m) => [m.name, m.employeeId]));
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
      if (rows.length === 0) { toast.error("Nothing to import — no name in the file matched anybody"); return; }
      const { error } = await (supabase as any)
        .from("attendance_days")
        .upsert(rows, { onConflict: "on_date,employee_id" });
      if (error) throw error;
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
      <div className="space-y-4">
        <BackButton />
        <WorkforceTabs />

        <ModuleHeader title="Time &amp; Attendance" description="Hours clocked, from TimeMoto">
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
          <TabsList>
            <TabsTrigger value="clocks">Clocks (TimeMoto)</TabsTrigger>
            <TabsTrigger value="marks">Board marks</TabsTrigger>
          </TabsList>

          <TabsContent value="clocks" className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
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
          <Figure label="Absence days" value={String(totals.absenceDays)} />
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
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead className="text-right">Worked</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead className="text-right">Days present</TableHead>
                      <TableHead>Absences</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {byPerson.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell className="text-right font-figure tabular-nums">{hm(p.worked)}</TableCell>
                        <TableCell className={`text-right font-figure tabular-nums ${p.balance < 0 ? "text-destructive-strong" : p.balance > 0 ? "text-success-strong" : ""}`}>
                          {hm(p.balance)}
                        </TableCell>
                        <TableCell className="text-right font-figure tabular-nums">{p.present}</TableCell>
                        <TableCell className="text-2xs">
                          {Object.keys(p.absences).length === 0
                            ? <span className="text-muted-foreground">—</span>
                            : Object.entries(p.absences).map(([k, n]) => `${k} ×${n}`).join(" · ")}
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
                  <Badge variant="outline">{preview.matched.length} of {preview.names.length} people matched</Badge>
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

                {(preview.unmatched.length > 0 || preview.skipped.length > 0) && (
                  <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-2xs">
                    <div className="flex items-center gap-1.5 font-semibold text-warning-strong">
                      <AlertTriangle className="h-3.5 w-3.5" /> Not imported
                    </div>
                    {preview.unmatched.length > 0 && (
                      <div>
                        <div className="font-semibold">Names nobody on the payroll answers to</div>
                        <div className="text-muted-foreground">{preview.unmatched.join(", ")}</div>
                      </div>
                    )}
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
                  <Button className="flex-1" onClick={commit} disabled={busy || !canManage || preview.matched.length === 0}>
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
