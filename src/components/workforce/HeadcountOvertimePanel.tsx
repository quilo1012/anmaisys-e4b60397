import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, TrendingUp } from "lucide-react";
import {
  buildShiftBalances, shiftTotals, shortfallIsReliable, type ShiftBalanceInput,
} from "@/lib/shiftBalance";

/**
 * Overtime across the pay period, read off the board.
 *
 * Counted in shifts throughout, because that is what the board records and what the
 * factory agreed to measure. The mockup this follows had hours in the top cards and
 * shifts in the detail panel; hours cannot be sourced for anybody until a TimeMoto
 * import lands, so a per-line hours figure would have been made up. Where a number
 * cannot be had, the card says so rather than showing a plausible one.
 *
 * There is no per-line overtime card, and the mockup this follows had one. The
 * company's own sheet lists overtime staff in a column of their own without saying
 * which line they worked, so fifty-three of the period's fifty-five overtime shifts
 * carry no area at all. A bar chart of that is a chart of one bar labelled "No area".
 * Department is what the data actually supports, and it is a real cut: sixteen of the
 * period's overtime shifts were worked by team leaders.
 */
const BAR_TONES = [
  "bg-primary", "bg-success", "bg-warning", "bg-destructive",
  "bg-primary", "bg-primary", "bg-warning", "bg-lime-500",
];

export function HeadcountOvertimePanel() {
  const { data } = useQuery({
    queryKey: ["headcount-overtime-panel"],
    queryFn: async () => {
      const db = supabase as any;

      // The pay period being closed, so this and Finance Close count the same days.
      const today = new Date().toISOString().slice(0, 10);
      const { data: periods } = await db
        .from("workforce_payroll_periods")
        .select("start_date, end_date")
        .lte("start_date", today).gte("end_date", today).limit(1);
      const period = periods?.[0];
      const from: string = period?.start_date
        ?? new Date(Date.now() - 27 * 86_400_000).toISOString().slice(0, 10);
      const to: string = period?.end_date ?? today;

      const [emp, allocs] = await Promise.all([
        db.from("employees")
          .select("id, full_name, department, shift_group, shift_patterns(name, days)")
          .eq("active", true),
        // Paged: PostgREST caps an unbounded select at 1000 rows without saying so,
        // and this period holds 1524. Reading the first thousand reported Felipe
        // Pinelli three shifts above his rota when he is six and left Fabio Silva,
        // also six, off the list — a wrong answer that looked like an answer.
        fetchAllRows<any>({
          range: (a, b) => db.from("daily_allocations")
            .select("employee_id, status, area_id, shift")
            .gte("on_date", from).lte("on_date", to)
            .order("on_date", { ascending: true }).order("employee_id", { ascending: true })
            .range(a, b),
        }),
      ]);
      if (emp.error) throw emp.error;

      const shiftOf = new Map(((emp.data ?? []) as any[]).map((e) => [e.id, e.shift_group ?? "Not set"]));
      // The spellings were fixed in `employees` — "Prodcution" was on 28 records and
      // split one department across three bars. Folding them here as well would hide
      // the next typo instead of showing it, so this only fills in the blank.
      const deptOf = new Map(((emp.data ?? []) as any[]).map(
        (e) => [e.id, (e.department ?? "").trim() || "Not set"],
      ));

      // Which boards anybody actually filled in. The night board has never been
      // planned, so everybody on it reads as a full period short — forty-eight
      // invented deficits burying the two or three that are real.
      const boardsPlanned = new Set<string>();
      for (const a of allocs as any[]) if (a.shift) boardsPlanned.add(a.shift);

      const counts = new Map<string, { present: number; holiday: number; sick: number; unpaid: number }>();
      const byDept = new Map<string, number>();
      const byShift = new Map<string, number>();
      for (const a of allocs as any[]) {
        const c = counts.get(a.employee_id) ?? { present: 0, holiday: 0, sick: 0, unpaid: 0 };
        if (a.status === "assigned" || a.status === "overtime") c.present += 1;
        else if (a.status === "holiday") c.holiday += 1;
        else if (a.status === "sick") c.sick += 1;
        else if (a.status === "unpaid") c.unpaid += 1;
        counts.set(a.employee_id, c);

        if (a.status === "overtime") {
          const dn = deptOf.get(a.employee_id) ?? "Not set";
          byDept.set(dn, (byDept.get(dn) ?? 0) + 1);
          const sg = shiftOf.get(a.employee_id) ?? "Not set";
          byShift.set(sg, (byShift.get(sg) ?? 0) + 1);
        }
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
      const balances = buildShiftBalances(input, from, to);

      return {
        from, to, balances,
        totals: shiftTotals(balances),
        byDept: [...byDept.entries()].sort((a, b) => b[1] - a[1]),
        byShift: [...byShift.entries()].sort((a, b) => b[1] - a[1]),
        noPattern: balances.filter((b) => !b.patternDays?.length).map((b) => b.name),
        unverified: balances.filter((b) => (b.balance ?? 0) < 0 && !shortfallIsReliable(b)),
      };
    },
  });

  const top = useMemo(
    () => (data?.balances ?? []).filter((b) => (b.balance ?? 0) > 0).slice(0, 5),
    [data],
  );

  if (!data) return null;
  const { totals, byDept, byShift, from, to } = data;
  const deptMax = Math.max(1, ...byDept.map(([, n]) => n));
  const shiftMax = Math.max(1, ...byShift.map(([, n]) => n));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <TrendingUp className="h-4 w-4 text-muted-foreground" /> Overtime this period
        </h2>
        <span className="text-2xs text-muted-foreground">
          {from} → {to} · counted in shifts, from the board
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {/* Not by line: the sheet does not record which line an overtime shift was
            worked on, so the honest cut is who worked it. */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Overtime shifts by department</CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            {byDept.length === 0 && <p className="text-2xs text-muted-foreground">No overtime marked this period.</p>}
            {byDept.slice(0, 8).map(([name, n], i) => (
              <div key={name} className="flex items-center gap-2 text-2xs">
                <span className="w-24 shrink-0 truncate text-muted-foreground">{name}</span>
                <span className="h-3 flex-1 overflow-hidden rounded bg-muted">
                  <span className={`block h-full ${BAR_TONES[i % BAR_TONES.length]}`} style={{ width: `${(n / deptMax) * 100}%` }} />
                </span>
                <span className="w-8 shrink-0 text-right font-figure tabular-nums">{n}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Overtime shifts by crew</CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            {byShift.length === 0 && <p className="text-2xs text-muted-foreground">No overtime marked this period.</p>}
            {byShift.map(([name, n], i) => (
              <div key={name} className="flex items-center gap-2 text-2xs">
                <span className="w-24 shrink-0 truncate text-muted-foreground">{name}</span>
                <span className="h-3 flex-1 overflow-hidden rounded bg-muted">
                  <span className={`block h-full ${BAR_TONES[i % BAR_TONES.length]}`} style={{ width: `${(n / shiftMax) * 100}%` }} />
                </span>
                <span className="w-8 shrink-0 text-right font-figure tabular-nums">{n}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Most shifts above their rota</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {top.length === 0 && <p className="text-2xs text-muted-foreground">Nobody is above their rota.</p>}
            {top.map((b, i) => (
              <div key={b.employeeId} className="flex items-center gap-2 border-b py-1 text-2xs last:border-0">
                <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-muted font-bold">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{b.name}</span>
                <span className="shrink-0 font-figure font-bold tabular-nums text-success-strong">+{b.balance}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* What the numbers above cannot be trusted about — the only card in the
            mockup that had to change, because the alerts it invented were real
            problems the system does not have and these are ones it does. */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Worth checking</CardTitle></CardHeader>
          <CardContent className="space-y-1.5 text-2xs">
            {totals.noBoardRecord > 0 && (
              <div className="flex gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" />
                <span>
                  <b>{totals.noBoardRecord}</b> with a rota and no board record at all. They read as a
                  full period short and almost certainly worked it.
                </span>
              </div>
            )}
            {/* Said apart, and last. A whole board nobody filled in is one job for one
                person; it is not forty-eight people to look into, and listed as such it
                buried the two or three that were. */}
            {totals.onUnplannedBoard > 0 && (
              <div className="flex gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground" />
                <span>
                  <b>{totals.onUnplannedBoard}</b> on a board nobody planned this period — the night
                  board is empty, so none of them counts as short.
                </span>
              </div>
            )}
            {data.unverified.length > 0 && (
              <div className="flex gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-warning-strong" />
                <span><b>{data.unverified.length}</b> shortfalls the board is too thin to confirm.</span>
              </div>
            )}
            {totals.noPattern > 0 && (
              <div className="flex gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-warning-strong" />
                <span><b>{totals.noPattern}</b> with no rota on file, so nothing is expected of them.</span>
              </div>
            )}
            <div className="flex gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              <span>
                <b>{totals.inOvertime}</b> above their rota, <b>+{totals.overtimeShifts}</b> shifts in total.
              </span>
            </div>
            {totals.noBoardRecord === 0 && data.unverified.length === 0 && totals.noPattern === 0 && (
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <AlertTriangle className="h-3 w-3" /> Nothing missing from the board this period.
              </div>
            )}
            <Link to="/dashboard/finance-close" className="mt-1 inline-block font-semibold text-primary">
              Full shift balance →
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
