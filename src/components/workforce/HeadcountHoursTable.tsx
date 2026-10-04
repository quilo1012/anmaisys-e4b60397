import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAllocations, useAllAreaNames, type HeadcountArea } from "@/hooks/useHeadcount";
import { hoursByArea, SHIFT_H } from "@/lib/headcountHours";

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * What the shift cost, by line.
 *
 * The grouping is in `@/lib/headcountHours` and counts every placement, including the
 * ones with no column on the board. This table used to walk the board's areas and
 * total up the rows it had drawn, so a placement on a switched-off line or with no
 * area at all was in neither — and the Total said so without saying so. Pill Line is
 * inactive and still took 2 to 4 people a day into October; 100 placements have no
 * area recorded, eight of them on one Day shift of forty people.
 */
export function HeadcountHoursTable({ date, shift, areas }: { date: string; shift: string; areas: HeadcountArea[] }) {
  const { data: allocations = [], isLoading } = useAllocations(date, shift);
  // Every area ever, the switched-off ones included, so an off-board row can name the
  // line instead of pointing at a gap.
  const { data: areaNameById } = useAllAreaNames();

  const { rows, totals } = useMemo(
    () => hoursByArea({ allocations, shift, areas, areaNameById }),
    [allocations, areas, shift, areaNameById],
  );

  const offBoard = rows.filter((r) => r.offBoard);
  const offBoardPeople = offBoard.reduce((n, r) => n + r.people + r.otPeople, 0);

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
          <>
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
                <tr key={r.key} className="border-b border-border/50">
                  <td className="py-1.5 pr-3">
                    {r.area}
                    {/* Said on the row, not only in the footnote: somebody reading one
                        line of this table needs to know this one has no column. */}
                    {r.offBoard && <span className="ml-1.5 text-2xs text-warning-strong">not on the board</span>}
                  </td>
                  <td className="py-1.5 px-3 text-right">{r.people}</td>
                  <td className="py-1.5 px-3 text-right">{fmt(r.hours)}</td>
                  <td className="py-1.5 px-3 text-right">{r.otPeople || "—"}</td>
                  <td className="py-1.5 px-3 text-right text-warning">{r.ot ? fmt(r.ot) : "—"}</td>
                  <td className="py-1.5 pl-3 text-right font-semibold">{fmt(r.hours + r.ot)}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="py-2 pr-3">Total</td>
                <td className="py-2 px-3 text-right">{totals.people}</td>
                <td className="py-2 px-3 text-right">{fmt(totals.hours)}</td>
                <td className="py-2 px-3 text-right">{totals.otPeople || "—"}</td>
                <td className="py-2 px-3 text-right text-warning">{totals.ot ? fmt(totals.ot) : "—"}</td>
                <td className="py-2 pl-3 text-right">{fmt(totals.hours + totals.ot)}</td>
              </tr>
            </tbody>
          </table>
          {offBoardPeople > 0 && (
            <p className="mt-2 text-2xs text-muted-foreground">
              {offBoardPeople === 1 ? "One person is" : `${offBoardPeople} people are`} placed where
              the board has no column — a line that has been switched off, or no area recorded on the
              placement. They worked the shift, so they are counted in the Total.
            </p>
          )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
