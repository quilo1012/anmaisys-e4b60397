import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAllocations, type Allocation, type HeadcountArea } from "@/hooks/useHeadcount";

/** Shifts are 06–18 / 18–06: 12h. A half day counts 6h. */
const SHIFT_H = 12;

const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
};

/** Hours worked by one placement, from the shift length, half day and late/early times. */
export function allocationHours(a: Allocation, shift: string): number {
  if (a.half_day) return SHIFT_H / 2;
  const start = shift === "Night" ? 18 * 60 : 6 * 60;
  const rel = (t: string) => ((toMin(t) - start) + 1440) % 1440;
  const from = a.arrived_late_at ? rel(a.arrived_late_at) : 0;
  const to = a.left_early_at ? rel(a.left_early_at) : SHIFT_H * 60;
  return Math.max(0, Math.min(SHIFT_H * 60, to) - from) / 60;
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function HeadcountHoursTable({ date, shift, areas }: { date: string; shift: string; areas: HeadcountArea[] }) {
  const { data: allocations = [], isLoading } = useAllocations(date, shift);

  const rows = useMemo(() => {
    const by = new Map<string, { people: number; hours: number; otPeople: number; ot: number }>();
    for (const a of allocations) {
      if (!a.area_id || (a.status !== "assigned" && a.status !== "overtime")) continue;
      const r = by.get(a.area_id) ?? { people: 0, hours: 0, otPeople: 0, ot: 0 };
      const h = allocationHours(a, shift);
      if (a.status === "overtime") { r.otPeople++; r.ot += h; } else { r.people++; r.hours += h; }
      by.set(a.area_id, r);
    }
    return areas
      .filter((ar) => by.has(ar.id))
      .map((ar) => ({ area: ar.name, ...by.get(ar.id)! }));
  }, [allocations, areas, shift]);

  const tot = rows.reduce(
    (s, r) => ({ people: s.people + r.people, hours: s.hours + r.hours, otPeople: s.otPeople + r.otPeople, ot: s.ot + r.ot }),
    { people: 0, hours: 0, otPeople: 0, ot: 0 },
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Hours by line — {date} · {shift} shift</CardTitle>
        <p className="text-xs text-muted-foreground">
          Hours = people placed × {SHIFT_H}h shift (half day 6h, late arrival / early leave deducted). Overtime = people placed as overtime.
        </p>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody placed on this day and shift yet.</p>
        ) : (
          <table className="w-full text-sm tabular-nums">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border text-left">
                <th className="py-2 pr-3 font-medium">Line / area</th>
                <th className="py-2 px-3 text-right font-medium">People</th>
                <th className="py-2 px-3 text-right font-medium">Hours</th>
                <th className="py-2 px-3 text-right font-medium">Overtime people</th>
                <th className="py-2 px-3 text-right font-medium">Overtime hours</th>
                <th className="py-2 pl-3 text-right font-medium">Total hours</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.area} className="border-b border-border/50">
                  <td className="py-1.5 pr-3">{r.area}</td>
                  <td className="py-1.5 px-3 text-right">{r.people}</td>
                  <td className="py-1.5 px-3 text-right">{fmt(r.hours)}</td>
                  <td className="py-1.5 px-3 text-right">{r.otPeople || "—"}</td>
                  <td className="py-1.5 px-3 text-right text-warning">{r.ot ? fmt(r.ot) : "—"}</td>
                  <td className="py-1.5 pl-3 text-right font-semibold">{fmt(r.hours + r.ot)}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="py-2 pr-3">Total</td>
                <td className="py-2 px-3 text-right">{tot.people}</td>
                <td className="py-2 px-3 text-right">{fmt(tot.hours)}</td>
                <td className="py-2 px-3 text-right">{tot.otPeople || "—"}</td>
                <td className="py-2 px-3 text-right text-warning">{tot.ot ? fmt(tot.ot) : "—"}</td>
                <td className="py-2 pl-3 text-right">{fmt(tot.hours + tot.ot)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
