import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, AlertTriangle, CalendarCheck } from "lucide-react";
import { downloadCsv } from "@/lib/exportCsv";
import {
  buildShiftBalances, shiftTotals, shortfallIsReliable, type ShiftBalanceInput,
} from "@/lib/shiftBalance";

/**
 * Overtime in shifts: what the rota called for against what the board recorded.
 *
 * Works for everybody today, which is the point — the hours model above needs a
 * TimeMoto import and the board is already filled in. It answers a different question
 * and the two are never added.
 */
export function ShiftBalancePanel({ from, to }: { from: string; to: string }) {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["shift-balance", from, to],
    enabled: !!from && !!to,
    queryFn: async () => {
      const db = supabase as any;
      const [emp, allocs] = await Promise.all([
        db.from("employees")
          .select("id, full_name, department, shift_pattern_id, shift_patterns(name, days)")
          .eq("active", true),
        db.from("daily_allocations")
          .select("employee_id, status, shift")
          .gte("on_date", from).lte("on_date", to),
      ]);
      if (emp.error) throw emp.error;
      if (allocs.error) throw allocs.error;

      // Which boards anybody actually filled in. The night board has never been
      // planned, so everybody on it reads as a full period short — forty-eight
      // invented deficits burying the two or three that are real.
      const boardsPlanned = new Set<string>();
      for (const a of (allocs.data ?? []) as any[]) if (a.shift) boardsPlanned.add(a.shift);

      const counts = new Map<string, { present: number; holiday: number; sick: number; unpaid: number }>();
      for (const a of (allocs.data ?? []) as any[]) {
        const c = counts.get(a.employee_id) ?? { present: 0, holiday: 0, sick: 0, unpaid: 0 };
        if (a.status === "assigned" || a.status === "overtime") c.present += 1;
        else if (a.status === "holiday") c.holiday += 1;
        else if (a.status === "sick") c.sick += 1;
        else if (a.status === "unpaid") c.unpaid += 1;
        counts.set(a.employee_id, c);
      }

      const input: ShiftBalanceInput[] = ((emp.data ?? []) as any[]).map((e) => {
        const c = counts.get(e.id) ?? { present: 0, holiday: 0, sick: 0, unpaid: 0 };
        return {
          employeeId: e.id, name: e.full_name, department: e.department ?? null,
          patternName: e.shift_patterns?.name ?? null,
          patternDays: e.shift_patterns?.days ?? null,
          boardPlanned: boardsPlanned.has(e.shift_group === "Night" ? "Night" : "Day"),
          ...c,
        };
      });
      // Only people the period touched: a rota, or something marked on the board.
      return buildShiftBalances(
        input.filter((r) => r.patternDays?.length || r.present + r.holiday + r.sick + r.unpaid > 0),
        from, to,
      );
    },
  });

  const totals = useMemo(() => shiftTotals(rows), [rows]);
  const shown = useMemo(() => rows.filter((r) => r.balance !== 0), [rows]);

  if (!from || !to) return null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <CalendarCheck className="h-4 w-4 text-muted-foreground" />
            Shift balance
          </h2>
          <p className="text-sm text-muted-foreground">
            What the rota called for against what the board recorded. Counted in shifts, not hours.
          </p>
        </div>
        <Button
          size="sm" variant="outline"
          disabled={rows.length === 0}
          onClick={() => downloadCsv(
            `shift-balance-${from}-to-${to}.csv`,
            ["Employee", "Department", "Rota", "Expected", "Holiday", "Needed", "Present", "Sick", "Unpaid", "Balance (shifts)", "Shortfall reliable"],
            rows.map((r) => [
              r.name, r.department ?? "", r.patternName ?? "",
              r.expected ?? "", r.holiday, r.needed ?? "", r.present, r.sick, r.unpaid,
              r.balance ?? "", shortfallIsReliable(r) ? "yes" : "no",
            ]),
          )}
        >
          <Download className="mr-1.5 h-4 w-4" /> Export
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "In overtime", value: `${totals.inOvertime}` },
          { label: "Overtime shifts", value: `+${totals.overtimeShifts}` },
          { label: "Short", value: `${totals.inDeficit}` },
          { label: "No board record", value: `${totals.noBoardRecord}` },
        ].map((k) => (
          <Card key={k.label}>
            <CardContent className="p-3">
              <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">{k.label}</div>
              <div className="font-mono text-xl font-bold tabular-nums">{k.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* The asymmetry, said before the table rather than under it: one column can be
          acted on and the other cannot, and they sit side by side looking alike. */}
      <p className="flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-2xs">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning-strong" />
        <span>
          <b>Overtime is reliable</b> — the board cannot invent a day somebody stood on a line.
          <b> A shortfall may not be.</b> A name the board import could not place shows a full
          period short while having worked it, so any row marked <i>unverified</i> is a gap in the
          record and not an absence.
          {totals.noBoardRecord > 0 && (
            <> <b>{totals.noBoardRecord}</b> {totals.noBoardRecord === 1 ? "person has" : "people have"} a
              rota and not one line on the board.</>
          )}
          {" "}Holiday comes off what was owed; sickness and unpaid leave are shown but still counted
          as due.
        </span>
      </p>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-center text-sm text-muted-foreground">Loading…</div>
          ) : shown.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              Nobody is above or below their rota in this period.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Rota</TableHead>
                    <TableHead className="text-right">Expected</TableHead>
                    <TableHead className="text-right">Holiday</TableHead>
                    <TableHead className="text-right">Needed</TableHead>
                    <TableHead className="text-right">Present</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((r) => {
                    const ok = shortfallIsReliable(r);
                    return (
                      <TableRow key={r.employeeId}>
                        <TableCell className="font-medium">
                          {r.name}
                          {!ok && (
                            <span className="ml-2 rounded-sm border border-amber-500/40 bg-amber-500/10 px-1 py-px text-[10px] font-semibold text-warning-strong">
                              unverified
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-2xs text-muted-foreground">{r.patternName ?? "no rota"}</TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">{r.expected ?? "—"}</TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                          {r.holiday || "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">{r.needed ?? "—"}</TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">{r.present}</TableCell>
                        <TableCell className={`text-right font-mono text-xs font-bold tabular-nums ${
                          r.balance == null ? "text-muted-foreground"
                            : r.balance > 0 ? "text-success-strong"
                            : ok ? "text-destructive-strong" : "text-warning-strong"}`}>
                          {r.balance == null ? "—" : r.balance > 0 ? `+${r.balance}` : r.balance}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
