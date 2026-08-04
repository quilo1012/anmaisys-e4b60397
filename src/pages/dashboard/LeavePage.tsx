import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { BackButton } from "@/components/BackButton";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CalendarDays, Check, X, Plus, Loader2, AlertTriangle } from "lucide-react";
import { useRole } from "@/hooks/useRole";
import { useAuth } from "@/contexts/AuthContext";
import { leaveDays, describeLeaveDays, leaveBalance, leaveYearOf } from "@/lib/leaveDays";
import { boardShiftFor } from "@/hooks/useHeadcount";

type Kind = "holiday" | "unpaid" | "sick";
type Status = "pending" | "approved" | "rejected" | "cancelled";

interface Req {
  id: string; employee_id: string; kind: Kind; start_date: string; end_date: string;
  working_days: number | null; note: string | null; status: Status;
  decided_at: string | null; created_at: string;
}

const KIND_LABEL: Record<Kind, string> = { holiday: "Holiday", unpaid: "Unpaid", sick: "Sick" };

/**
 * Leave asked for, and leave granted.
 *
 * Approving writes the days to two places, because two screens have to agree:
 * `employee_attendance`, which the finance close counts, and `daily_allocations`,
 * which the board draws. Doing it here rather than in a database trigger keeps it
 * visible and reversible — the same reason the rest of the workforce writes are
 * app-side.
 */
export default function LeavePage() {
  const qc = useQueryClient();
  const { can } = useRole();
  const { user } = useAuth();
  const canDecide = can("workforce.manage");

  const [showNew, setShowNew] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [kind, setKind] = useState<Kind>("holiday");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: roster = [] } = useQuery({
    queryKey: ["leave-roster"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("employees")
        .select("id, full_name, department, shift_group, shift_pattern_id")
        .eq("active", true).order("full_name");
      if (error) throw error;
      return (data ?? []) as { id: string; full_name: string; department: string | null; shift_group: string | null; shift_pattern_id: string | null }[];
    },
  });

  const { data: patterns = [] } = useQuery({
    queryKey: ["leave-patterns"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("shift_patterns").select("id, name, days, annual_leave_days, leave_includes_bank_holidays");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string; days: number[]; annual_leave_days: number | null; leave_includes_bank_holidays: boolean | null }[];
    },
  });

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ["leave-requests"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("leave_requests").select("*").order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Req[];
    },
  });

  /**
   * Time off put straight onto the headcount board, with no request behind it.
   *
   * The board is the faster way to mark somebody off and people use it, so this
   * screen showing only `leave_requests` meant a day like Anderson Cavalcante's 06/08
   * simply did not exist here. Listed rather than hidden: a day off is a day off,
   * whether it came through approval or not.
   */
  /**
   * Every holiday day actually on the record, whatever put it there.
   *
   * The same table the finance close counts. Reading approved requests instead made
   * this screen say 3 where the close said 4, because a day marked on the board has
   * no request behind it. One source, one number.
   */
  const { data: holidayDays = [] } = useQuery({
    queryKey: ["leave-holiday-days"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("employee_attendance")
        .select("employee_id, on_date")
        .eq("status", "holiday")
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as { employee_id: string; on_date: string }[];
    },
  });

  const { data: boardOnly = [] } = useQuery({
    queryKey: ["leave-board-only"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("daily_allocations")
        .select("employee_id, on_date, status")
        .in("status", ["holiday", "absence"])
        .order("on_date", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as { employee_id: string; on_date: string; status: string }[];
    },
  });

  const person = useMemo(() => new Map(roster.map((e) => [e.id, e])), [roster]);
  const patternOf = (id: string) => {
    const p = person.get(id);
    return patterns.find((x) => x.id === p?.shift_pattern_id)?.days ?? null;
  };

  // What the person is asking for, worked out before anybody presses anything.
  const draft = useMemo(
    () => (employeeId && start && end ? leaveDays(start, end, patternOf(employeeId)) : null),
    [employeeId, start, end, patterns, roster],
  );

  // Entitlement is per shift pattern, in working days of that pattern — 22.5 for
  // Mon–Thu, 21.5 for Tue–Fri. A flat 28 for everybody would hand the Tue–Fri crew a
  // day they do not have, and short the others.
  const today = new Date().toISOString().slice(0, 10);
  const year = leaveYearOf(today);
  const balances = useMemo(() => {
    return roster
      .map((e) => {
        const pat = patterns.find((p) => p.id === e.shift_pattern_id);
        const mine = holidayDays.filter((d) => d.employee_id === e.id);
        const b = leaveBalance(
          mine.map((d) => ({ date: d.on_date })),
          pat?.annual_leave_days ?? null,
          today,
        );
        return { id: e.id, name: e.full_name, pattern: pat?.name ?? null, ...b };
      })
      .filter((b) => b.taken > 0 || b.booked > 0)
      .sort((a, b) => (a.remaining ?? Infinity) - (b.remaining ?? Infinity));
  }, [roster, patterns, holidayDays, today]);

  /**
   * The same three figures BrightPay prints, but per shift pattern rather than per
   * person — the entitlement belongs to the pattern, so this is the row a manager
   * checks the individual balances against.
   */
  const byPattern = useMemo(() => {
    return patterns
      .map((pat) => {
        const people = roster.filter((e) => e.shift_pattern_id === pat.id);
        const ids = new Set(people.map((e) => e.id));
        const mine = holidayDays.filter((d) => ids.has(d.employee_id));
        const b = leaveBalance(
          mine.map((d) => ({ date: d.on_date })),
          pat.annual_leave_days ?? null,
          today,
        );
        return { id: pat.id, name: pat.name, people: people.length, bankHols: pat.leave_includes_bank_holidays, ...b };
      })
      .filter((p) => p.people > 0)
      .sort((a, b) => b.people - a.people);
  }, [patterns, roster, holidayDays, today]);

  /** Approved leave running now or starting within a fortnight. */
  const whosOff = useMemo(() => {
    const horizon = new Date(`${today}T00:00:00Z`);
    horizon.setUTCDate(horizon.getUTCDate() + 14);
    const until = horizon.toISOString().slice(0, 10);
    return requests
      .filter((r) => r.status === "approved" && r.end_date >= today && r.start_date <= until)
      .sort((a, b) => a.start_date.localeCompare(b.start_date));
  }, [requests, today]);

  const kpis = useMemo(() => {
    const approved = requests.filter((r) => r.status === "approved");
    const month = today.slice(0, 7);
    const onDay = (r: Req) => r.start_date <= today && r.end_date >= today;
    return {
      pending: requests.filter((r) => r.status === "pending").length,
      approvedThisMonth: approved.filter((r) => (r.decided_at ?? "").slice(0, 7) === month).length,
      bookedDays: approved
        .filter((r) => r.kind === "holiday" && r.end_date >= today)
        .reduce((a, r) => a + Number(r.working_days ?? 0), 0),
      offToday: approved.filter(onDay).length,
      sickToday: approved.filter((r) => r.kind === "sick" && onDay(r)).length,
    };
  }, [requests, today]);

  // A board day is "covered" when an approved request already spans it.
  const uncovered = useMemo(() => {
    const approved = requests.filter((r) => r.status === "approved");
    return boardOnly
      .filter((d) => !approved.some(
        (r) => r.employee_id === d.employee_id && r.start_date <= d.on_date && r.end_date >= d.on_date,
      ))
      .sort((a, b) => b.on_date.localeCompare(a.on_date));
  }, [boardOnly, requests]);

  const pending = requests.filter((r) => r.status === "pending");
  const decided = requests.filter((r) => r.status !== "pending").slice().reverse();

  const create = async () => {
    if (!employeeId || !start || !end || !draft) return;
    setBusy(true);
    try {
      const { error } = await (supabase as any).from("leave_requests").insert({
        employee_id: employeeId, kind, start_date: start, end_date: end,
        working_days: draft.workingDays, note: note.trim() || null, requested_by: user?.id ?? null,
      });
      if (error) throw error;
      toast.success("Request raised");
      setShowNew(false); setEmployeeId(""); setStart(""); setEnd(""); setNote("");
      qc.invalidateQueries({ queryKey: ["leave-requests"] });
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  const decide = async (r: Req, approve: boolean) => {
    setBusy(true);
    try {
      if (approve) {
        const days = leaveDays(r.start_date, r.end_date, patternOf(r.employee_id));
        if (days.workingDays == null) {
          toast.error("No rota on file for this person — set their working pattern first");
          return;
        }
        if (days.workingDates.length > 0) {
          // Both tables, one action. The close counts `employee_attendance`; the board
          // draws `daily_allocations`. Writing one without the other is how the two
          // screens come to disagree about the same day off.
          const status = r.kind === "sick" ? "sick" : r.kind === "unpaid" ? "unpaid" : "holiday";
          const { error: attErr } = await (supabase as any).from("employee_attendance").upsert(
            days.workingDates.map((d) => ({
              employee_id: r.employee_id, on_date: d, status,
              note: `Leave request ${r.id.slice(0, 8)}`,
            })),
            { onConflict: "employee_id,on_date" },
          );
          if (attErr) throw attErr;

          // Only where the board knows which shift to draw them on. An unrecorded
          // shift group is not guessed at — the attendance still counts.
          const shift = boardShiftFor(person.get(r.employee_id)?.shift_group);
          if (shift) {
            const { error: allocErr } = await (supabase as any).from("daily_allocations").upsert(
              days.workingDates.map((d) => ({
                on_date: d, shift, employee_id: r.employee_id,
                area_id: null, status: r.kind === "sick" ? "absence" : "holiday",
              })),
              { onConflict: "on_date,shift,employee_id" },
            );
            if (allocErr) throw allocErr;
          }
        }
      }
      const { error } = await (supabase as any).from("leave_requests")
        .update({ status: approve ? "approved" : "rejected", decided_by: user?.id ?? null, decided_at: new Date().toISOString() })
        .eq("id", r.id);
      if (error) throw error;
      toast.success(approve ? "Approved and written to the board" : "Rejected");
      qc.invalidateQueries({ queryKey: ["leave-requests"] });
      qc.invalidateQueries({ queryKey: ["headcount-allocations"] });
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  const row = (r: Req) => {
    const p = person.get(r.employee_id);
    const d = leaveDays(r.start_date, r.end_date, patternOf(r.employee_id));
    return (
      <TableRow key={r.id}>
        <TableCell className="font-medium">{p?.full_name ?? "Unknown"}</TableCell>
        <TableCell><Badge variant="outline" className="text-2xs">{KIND_LABEL[r.kind]}</Badge></TableCell>
        <TableCell className="text-xs">{r.start_date} → {r.end_date}</TableCell>
        <TableCell className={`text-right font-mono text-xs tabular-nums ${d.workingDays == null ? "text-destructive-strong" : ""}`}>
          {describeLeaveDays(d)}
        </TableCell>
        <TableCell className="max-w-[220px] truncate text-2xs text-muted-foreground">{r.note ?? "—"}</TableCell>
        <TableCell className="text-right">
          {r.status === "pending" ? (
            canDecide && (
              <span className="flex justify-end gap-1.5">
                <Button size="sm" variant="outline" className="h-7" disabled={busy} onClick={() => decide(r, false)}>
                  <X className="mr-1 h-3.5 w-3.5" />Reject
                </Button>
                <Button size="sm" className="h-7" disabled={busy} onClick={() => decide(r, true)}>
                  <Check className="mr-1 h-3.5 w-3.5" />Approve
                </Button>
              </span>
            )
          ) : (
            <Badge variant={r.status === "approved" ? "default" : "outline"} className="text-2xs capitalize">{r.status}</Badge>
          )}
        </TableCell>
      </TableRow>
    );
  };

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <BackButton />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <CalendarDays className="h-6 w-6 text-muted-foreground" />
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Leave</h1>
              <p className="text-sm text-muted-foreground">Requests, and what happens when they are approved</p>
            </div>
          </div>
          <Button size="sm" onClick={() => setShowNew((v) => !v)}>
            <Plus className="mr-1.5 h-4 w-4" /> New request
          </Button>
        </div>

        {showNew && (
          <Card>
            <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="lg:col-span-2">
                <Label className="text-xs">Employee</Label>
                <Select value={employeeId} onValueChange={setEmployeeId}>
                  <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Choose somebody" /></SelectTrigger>
                  <SelectContent>
                    {roster.map((e) => <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Type</Label>
                <Select value={kind} onValueChange={(v) => setKind(v as Kind)}>
                  <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="holiday">Holiday</SelectItem>
                    <SelectItem value="unpaid">Unpaid</SelectItem>
                    <SelectItem value="sick">Sick</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-xs">From</Label><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="mt-1 h-9" /></div>
                <div><Label className="text-xs">To</Label><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="mt-1 h-9" /></div>
              </div>
              <div className="lg:col-span-3">
                <Label className="text-xs">Note</Label>
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="mt-1" placeholder="Optional" />
              </div>
              <div className="flex flex-col justify-end gap-2">
                {/* Worked out before anybody presses anything: a week off for a
                    Mon–Thu person is four days, and the form says so rather than
                    letting somebody find out after approval. */}
                {draft && (
                  <p className="text-2xs text-muted-foreground">
                    {describeLeaveDays(draft)} · {draft.calendarDays} calendar day{draft.calendarDays === 1 ? "" : "s"}
                  </p>
                )}
                <Button onClick={create} disabled={busy || !employeeId || !start || !end}>
                  {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Raise request
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {[
            { label: "Pending", value: String(kpis.pending), warn: kpis.pending > 0 },
            { label: "Approved this month", value: String(kpis.approvedThisMonth) },
            { label: "Booked days ahead", value: String(kpis.bookedDays) },
            { label: "Off today", value: String(kpis.offToday) },
            { label: "Sick today", value: String(kpis.sickToday) },
          ].map((k) => (
            <Card key={k.label}>
              <CardContent className="p-3">
                <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">{k.label}</div>
                <div className={`font-mono text-xl font-bold tabular-nums ${k.warn ? "text-warning-strong" : ""}`}>{k.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {byPattern.length > 0 && (
          <div>
            <h2 className="mb-2 text-2xs font-bold uppercase tracking-widest text-muted-foreground">
              Entitlement by shift · {year.from} → {year.to}
            </h2>
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Shift pattern</TableHead>
                      <TableHead className="text-right">People</TableHead>
                      <TableHead className="text-right">Taken</TableHead>
                      <TableHead className="text-right">Booked</TableHead>
                      <TableHead className="text-right">Remaining</TableHead>
                      <TableHead className="text-right">Annual total</TableHead>
                      <TableHead className="text-right">Bank hols</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {byPattern.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">{p.people}</TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">{p.taken}</TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">{p.booked}</TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">
                          {p.remaining == null ? <span className="text-muted-foreground">—</span> : p.remaining}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">
                          {/* BrightPay has not given the Mon–Fri or Sun figures, and nine
                              people are on those. "to confirm" asks for them; a zero
                              would quietly claim they have none. */}
                          {p.total ?? <span className="text-warning-strong">to confirm</span>}
                        </TableCell>
                        {/* Whether the entitlement already swallows the bank holidays
                            or they sit on top of it. Two patterns say no — Fri–Mon and
                            the Sunday crews — and paying either as though it said yes
                            is a real day, per person, per year. */}
                        <TableCell className="text-right text-2xs">
                          {p.bankHols == null ? <span className="text-muted-foreground">—</span>
                            : p.bankHols ? "included" : <span className="text-warning-strong">on top</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        )}

        {uncovered.length > 0 && (
          <div>
            <h2 className="mb-2 flex items-center gap-1.5 text-2xs font-bold uppercase tracking-widest text-warning-strong">
              <AlertTriangle className="h-3.5 w-3.5" />
              Marked on the board, no request ({uncovered.length})
            </h2>
            <Card className="border-amber-500/40">
              <CardContent className="divide-y p-0">
                {uncovered.slice(0, 20).map((d) => (
                  <div key={`${d.employee_id}-${d.on_date}`} className="flex items-center gap-2.5 px-3 py-2 text-xs">
                    <span className="font-medium">{person.get(d.employee_id)?.full_name ?? "Unknown"}</span>
                    <Badge variant="outline" className="text-2xs capitalize">{d.status}</Badge>
                    <span className="ml-auto font-mono text-2xs text-muted-foreground">{d.on_date}</span>
                  </div>
                ))}
                <p className="px-3 py-2 text-2xs text-muted-foreground">
                  Put straight onto the headcount board rather than through a request. They show as off
                  on the board. Raise a request covering the dates if the finance close needs them and
                  they were marked before this screen started writing the attendance record.
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {whosOff.length > 0 && (
          <div>
            <h2 className="mb-2 text-2xs font-bold uppercase tracking-widest text-muted-foreground">
              Who is off · next two weeks
            </h2>
            <Card>
              <CardContent className="divide-y p-0">
                {whosOff.map((r) => (
                  <div key={r.id} className="flex items-center gap-2.5 px-3 py-2 text-xs">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${
                      r.kind === "sick" ? "bg-destructive" : r.kind === "unpaid" ? "bg-orange-500" : "bg-primary"}`} />
                    <span className="font-medium">{person.get(r.employee_id)?.full_name ?? "Unknown"}</span>
                    <Badge variant="outline" className="text-2xs">{KIND_LABEL[r.kind]}</Badge>
                    <span className="ml-auto font-mono text-2xs text-muted-foreground">
                      {r.start_date === r.end_date ? r.start_date : `${r.start_date} → ${r.end_date}`}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        )}

        {balances.length > 0 && (
          <div>
            <h2 className="mb-2 text-2xs font-bold uppercase tracking-widest text-muted-foreground">
              Holiday balance · leave year {year.from} → {year.to}
              <span className="ml-2 font-normal normal-case tracking-normal text-muted-foreground">
                counted from the attendance record, the same days the finance close counts
              </span>
            </h2>
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead><TableHead>Pattern</TableHead>
                      <TableHead className="text-right">Taken</TableHead>
                      <TableHead className="text-right">Booked</TableHead>
                      <TableHead className="text-right">Remaining</TableHead>
                      <TableHead className="text-right">Entitlement</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {balances.map((b) => (
                      <TableRow key={b.id}>
                        <TableCell className="font-medium">{b.name}</TableCell>
                        <TableCell className="text-2xs text-muted-foreground">{b.pattern ?? "no rota"}</TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">{b.taken}</TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">{b.booked}</TableCell>
                        {/* No entitlement on file is not "no days left" — it is nobody
                            having told us how many there are. BrightPay has not given
                            the Mon–Fri or Sun figures yet. */}
                        <TableCell className={`text-right font-mono text-xs font-semibold tabular-nums ${
                          b.remaining == null ? "text-muted-foreground"
                            : b.remaining < 0 ? "text-destructive-strong" : ""}`}>
                          {b.remaining == null ? "not set" : b.remaining}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                          {b.total ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        )}

        <div>
          <h2 className="mb-2 text-2xs font-bold uppercase tracking-widest text-muted-foreground">
            Waiting for a decision ({pending.length})
          </h2>
          <Card>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-6 text-center text-sm text-muted-foreground">Loading…</div>
              ) : pending.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">Nothing waiting.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead><TableHead>Type</TableHead><TableHead>Dates</TableHead>
                      <TableHead className="text-right">Length</TableHead><TableHead>Note</TableHead><TableHead />
                    </TableRow>
                  </TableHeader>
                  {/* Oldest first: whoever has waited longest is at the top. */}
                  <TableBody>{pending.map(row)}</TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        {decided.length > 0 && (
          <div>
            <h2 className="mb-2 text-2xs font-bold uppercase tracking-widest text-muted-foreground">Decided</h2>
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead><TableHead>Type</TableHead><TableHead>Dates</TableHead>
                      <TableHead className="text-right">Length</TableHead><TableHead>Note</TableHead><TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>{decided.map(row)}</TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        )}

        <p className="flex items-start gap-1.5 text-2xs text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Approving writes the working days to the attendance record, which the finance close
          counts, and to the headcount board, which draws them as off. Days are counted against
          the person's rota — a week off for a Mon–Thu crew is four days, not seven — and a
          person with no rota on file cannot be approved until one is set.
        </p>
      </div>
    </DashboardLayout>
  );
}
