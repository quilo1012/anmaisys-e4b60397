import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CalendarRange } from "lucide-react";
import { cn } from "@/lib/utils";
import { hoursOnSite } from "@/lib/overtime";
import { describeDays } from "@/hooks/useWorkforce";

/**
 * The pay period as a calendar, and what each rota owes across it.
 *
 * The board answers a day at a time and the balance answers a person at a time.
 * Neither says the thing a supervisor asks first: how long is this period, and how
 * many shifts is a Fri–Mon meant to work in it. That was arithmetic somebody did on
 * paper — sixteen days at eleven hours — and getting it wrong makes every balance
 * below it wrong in the same direction.
 *
 * Twenty-eight days is four whole weeks, so every four-day rota is exactly sixteen
 * shifts and every five-day rota twenty. That is a property of this period and not a
 * rule: a period that does not divide by seven gives a rota one more of some weekdays
 * than others, which is why the count is taken day by day rather than multiplied.
 *
 * Hours are the rota's own: clock-out less clock-in less the unpaid break. Eleven for
 * a twelve-hour shift, seven for a nine-to-five. They are shown beside the shift count
 * rather than instead of it — the factory settles overtime in shifts, and the hours
 * are what the rota is worth, not what anybody worked.
 */
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function eachDay(from: string, to: string): { iso: string; day: number; weekday: number }[] {
  const out: { iso: string; day: number; weekday: number }[] = [];
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return out;
  for (let t = start; t <= end; t += 86_400_000) {
    const d = new Date(t);
    out.push({ iso: d.toISOString().slice(0, 10), day: d.getUTCDate(), weekday: d.getUTCDay() || 7 });
  }
  return out;
}

export function PeriodCalendar() {
  const [highlight, setHighlight] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["period-calendar"],
    queryFn: async () => {
      const db = supabase as any;
      const today = new Date().toISOString().slice(0, 10);
      const { data: periods } = await db
        .from("workforce_payroll_periods")
        .select("name, start_date, end_date")
        .lte("start_date", today).gte("end_date", today).limit(1);
      const p = periods?.[0];
      const from: string = p?.start_date ?? new Date(Date.now() - 27 * 86_400_000).toISOString().slice(0, 10);
      const to: string = p?.end_date ?? today;

      const { data: pats, error } = await db
        .from("shift_patterns")
        .select("id, name, days, starts_at, ends_at, break_minutes, active")
        .eq("active", true).order("name");
      if (error) throw error;

      const { data: emp } = await db
        .from("employees").select("shift_pattern_id").eq("active", true);
      const headcount = new Map<string, number>();
      for (const e of (emp ?? []) as any[]) {
        if (e.shift_pattern_id) headcount.set(e.shift_pattern_id, (headcount.get(e.shift_pattern_id) ?? 0) + 1);
      }

      const days = eachDay(from, to);
      const rotas = ((pats ?? []) as any[]).map((r) => {
        const shifts = days.filter((d) => (r.days ?? []).includes(d.weekday)).length;
        const perShift = r.starts_at && r.ends_at
          ? Math.max(0, hoursOnSite(r.starts_at, r.ends_at) - (r.break_minutes ?? 0) / 60)
          : null;
        return {
          id: r.id, name: r.name, days: (r.days ?? []) as number[],
          shifts, perShift,
          total: perShift == null ? null : Math.round(perShift * shifts * 10) / 10,
          people: headcount.get(r.id) ?? 0,
        };
      }).sort((a, b) => b.people - a.people || a.name.localeCompare(b.name));

      return { from, to, name: p?.name ?? null, days, rotas };
    },
  });

  const shown = useMemo(() => data?.rotas.filter((r) => r.people > 0) ?? [], [data]);
  if (!data) return null;

  const active = data.rotas.find((r) => r.id === highlight) ?? null;
  const weeks = Math.round(data.days.length / 7);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <CalendarRange className="h-4 w-4 text-muted-foreground" /> Working period
        </h2>
        <span className="text-2xs text-muted-foreground">
          {data.name ? `${data.name} · ` : ""}{data.from} → {data.to} · {data.days.length} days
          {data.days.length % 7 === 0 ? ` (${weeks} whole weeks)` : ""}
        </span>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,320px)_1fr]">
        <Card>
          <CardContent className="p-3">
            <div className="grid grid-cols-7 gap-1">
              {WEEKDAYS.map((w) => (
                <div key={w} className="pb-1 text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {w}
                </div>
              ))}
              {/* The period starts on whatever weekday it starts on; blanks keep the
                  columns honest so a Friday sits under Fri. */}
              {Array.from({ length: (data.days[0]?.weekday ?? 1) - 1 }).map((_, i) => (
                <div key={`pad${i}`} />
              ))}
              {data.days.map((d) => {
                const on = active ? active.days.includes(d.weekday) : false;
                return (
                  <div
                    key={d.iso}
                    title={d.iso}
                    className={cn(
                      "grid h-8 place-items-center rounded-md border text-2xs tabular-nums",
                      on ? "border-primary/50 bg-primary/15 font-bold text-primary"
                        : active ? "border-transparent bg-muted/40 text-muted-foreground/60"
                        : "bg-card",
                    )}
                  >
                    {d.day}
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-2xs text-muted-foreground">
              {active
                ? <><b>{active.name}</b> — {active.shifts} shifts highlighted.</>
                : "Pick a rota to see the days it works."}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rota</TableHead>
                    <TableHead className="text-right">People</TableHead>
                    <TableHead className="text-right">Shifts</TableHead>
                    <TableHead className="text-right">Hours each</TableHead>
                    <TableHead className="text-right">Total hours</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((r) => (
                    <TableRow
                      key={r.id}
                      className={cn("cursor-pointer", highlight === r.id && "bg-muted/60")}
                      onClick={() => setHighlight(highlight === r.id ? null : r.id)}
                    >
                      <TableCell>
                        <div className="font-medium">{r.name}</div>
                        <div className="text-2xs text-muted-foreground">{describeDays(r.days)}</div>
                      </TableCell>
                      <TableCell className="text-right font-figure text-xs text-muted-foreground">
                        {r.people}
                      </TableCell>
                      <TableCell className="text-right font-figure text-xs font-bold">{r.shifts}</TableCell>
                      <TableCell className="text-right font-figure text-xs">
                        {r.perShift == null ? "—" : `${r.perShift}h`}
                      </TableCell>
                      <TableCell className="text-right font-figure text-xs font-semibold">
                        {r.total == null ? "—" : `${r.total}h`}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
