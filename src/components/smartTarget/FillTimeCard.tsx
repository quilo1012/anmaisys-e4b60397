import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useItouchCycles } from "@/hooks/useItouchCycles";
import { useFillTimeShifts } from "@/hooks/useFillTimeShifts";
import { cleanCycles } from "@/lib/smartTargetRates";
import { fillTimes, MIN_SHIFTS, type FillTimeRow } from "@/lib/fillTimes";
import { cn } from "@/lib/utils";

const sec = (s: number | null) => (s === null ? "—" : `${s.toFixed(2)} s`);
const FLAG: Record<NonNullable<FillTimeRow["flag"]>, string> = {
  few_shifts: `Under ${MIN_SHIFTS} shifts`,
  far_from_itouch: "Far from iTouch",
  no_itouch: "No iTouch cycle",
};

/** Stage 1: real fill time per product beside iTouch's standard. Check only — targets do not use it. */
export function FillTimeCard() {
  const shifts = useFillTimeShifts(90);
  const cycles = useItouchCycles();
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const rows = useMemo(
    () => fillTimes(shifts.data ?? [], cycles.data ? cleanCycles(cycles.data.records).cycles : []),
    [shifts.data, cycles.data],
  );
  const shown = onlyFlagged ? rows.filter((r) => r.flag) : rows;

  return (
    <Card data-testid="fill-time-card">
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>Fill time per product</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Run time ÷ units made, per shift, last 90 days, beside iTouch's standard cycle. For checking only — Smart Target does not use these numbers yet.
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm">
          <input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} className="h-5 w-5" />
          Only ones to check
        </label>
      </CardHeader>
      <CardContent>
        {shifts.isLoading || cycles.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : shifts.error ? (
          <p className="text-sm text-destructive">Could not read production history: {(shifts.error as Error).message}</p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">No shifts with both run time and units in the last 90 days.</p>
        ) : (
          <div className="max-h-[480px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="p-2">Line</th><th className="p-2">Product</th>
                  <th className="p-2 text-right">Shifts</th><th className="p-2 text-right">Real (median)</th>
                  <th className="p-2 text-right">Best</th><th className="p-2 text-right">Worst</th>
                  <th className="p-2 text-right">Units/h</th><th className="p-2 text-right">iTouch</th>
                  <th className="p-2 text-right">vs iTouch</th><th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={`${r.line}|${r.sku}`} className="border-t">
                    <td className="p-2">Line {r.line}</td>
                    <td className="p-2"><div className="font-medium">{r.sku}</div>{r.name && <div className="text-xs text-muted-foreground">{r.name}</div>}</td>
                    <td className="p-2 text-right tabular-nums">{r.shifts}</td>
                    <td className="p-2 text-right font-semibold tabular-nums">{sec(r.medianSeconds)}</td>
                    <td className="p-2 text-right tabular-nums">{sec(r.bestSeconds)}</td>
                    <td className="p-2 text-right tabular-nums">{sec(r.worstSeconds)}</td>
                    <td className="p-2 text-right tabular-nums">{Math.round(r.unitsPerHour).toLocaleString("en-GB")}</td>
                    <td className="p-2 text-right tabular-nums">{sec(r.itouchSeconds)}</td>
                    <td className={cn("p-2 text-right tabular-nums", r.flag === "far_from_itouch" && "text-warning font-semibold")}>
                      {r.vsItouch === null ? "—" : `${r.vsItouch > 0 ? "+" : ""}${Math.round(r.vsItouch * 100)}%`}
                    </td>
                    <td className="p-2">{r.flag && <Badge variant="outline">{FLAG[r.flag]}</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
