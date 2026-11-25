import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useItouchCycles } from "@/hooks/useItouchCycles";
import { useFillTimeShifts } from "@/hooks/useFillTimeShifts";
import { cleanCycles } from "@/lib/smartTargetRates";
import { fillTimes, MIN_SHIFTS, type FillTimeRow } from "@/lib/fillTimes";
import { packSizeKg, timeMotionFor } from "@/lib/packSize";
import { TIME_MOTION_SOURCE } from "@/lib/timeMotionMatrix";
import { cn } from "@/lib/utils";

const sec = (s: number | null | undefined) => (s == null ? "—" : `${s.toFixed(2)} s`);
const pct = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : ""}${Math.round(v * 100)}%`);
const kgLabel = (kg: number | null) => (kg === null ? "—" : kg < 1 ? `${Math.round(kg * 1000)} g` : `${kg} kg`);
const FLAG: Record<NonNullable<FillTimeRow["flag"]>, string> = {
  few_shifts: `Under ${MIN_SHIFTS} shifts`,
  far_from_itouch: "Far from iTouch",
  no_itouch: "No iTouch cycle",
};

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <div className="rounded-lg border bg-muted/30 px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-2xl font-semibold tabular-nums", tone === "warn" && value > 0 && "text-warning")}>{value}</div>
    </div>
  );
}

/** Real fill time per product beside iTouch and the Time & Motion review. Check only — targets do not use it. */
export function FillTimeCard() {
  const shifts = useFillTimeShifts(90);
  const cycles = useItouchCycles();
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const rows = useMemo(() => {
    const base = fillTimes(shifts.data ?? [], cycles.data ? cleanCycles(cycles.data.records).cycles : []);
    return base.map((r) => {
      const kg = packSizeKg(r.name);
      const tm = timeMotionFor(r.line, kg);
      const tmSec = tm ? tm[2] : null;
      return { ...r, kg, tmSec, tmBasis: tm?.[3] ?? null, vsTm: tmSec ? (r.medianSeconds - tmSec) / tmSec : null };
    });
  }, [shifts.data, cycles.data]);
  const shown = onlyFlagged ? rows.filter((r) => r.flag || r.tmSec === null) : rows;
  const missing = rows.filter((r) => r.tmSec === null);

  return (
    <Card data-testid="fill-time-card">
      <CardHeader className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <CardTitle>Fill time per product</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Real seconds per unit (run time ÷ units, median of shifts, last 90 days) against iTouch's standard cycle and the {TIME_MOTION_SOURCE}, matched by line and pack size. For checking only — Smart Target does not use these numbers.
            </p>
          </div>
          <label className="flex shrink-0 items-center gap-2 text-sm">
            <input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} className="h-5 w-5" />
            Only ones to check
          </label>
        </div>
        {rows.length > 0 && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Products" value={rows.length} />
            <Stat label="With Time & Motion" value={rows.length - missing.length} />
            <Stat label="No Time & Motion" value={missing.length} tone="warn" />
            <Stat label="Under 5 shifts" value={rows.filter((r) => r.shifts < MIN_SHIFTS).length} tone="warn" />
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {shifts.isLoading || cycles.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : shifts.error ? (
          <p className="text-sm text-destructive">Could not read production history: {(shifts.error as Error).message}</p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">No shifts with both run time and units in the last 90 days.</p>
        ) : (
          <div className="max-h-[560px] overflow-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-muted text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="p-2 text-left" colSpan={4}>Product</th>
                  <th className="border-l p-2 text-center" colSpan={4}>Real (this app)</th>
                  <th className="border-l p-2 text-center" colSpan={2}>iTouch</th>
                  <th className="border-l p-2 text-center" colSpan={2}>Time &amp; Motion</th>
                  <th className="border-l p-2" />
                </tr>
                <tr className="border-t">
                  <th className="p-2 text-left">Line</th><th className="p-2 text-left">Product</th>
                  <th className="p-2 text-right">Pack</th><th className="p-2 text-right">Shifts</th>
                  <th className="border-l p-2 text-right">Median</th><th className="p-2 text-right">Best</th>
                  <th className="p-2 text-right">Worst</th><th className="p-2 text-right">Units/h</th>
                  <th className="border-l p-2 text-right">Cycle</th><th className="p-2 text-right">vs real</th>
                  <th className="border-l p-2 text-right">Fill</th><th className="p-2 text-right">vs real</th>
                  <th className="border-l p-2 text-left">Check</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={`${r.line}|${r.sku}`} className="border-t odd:bg-muted/20">
                    <td className="whitespace-nowrap p-2">Line {r.line}</td>
                    <td className="p-2"><div className="font-medium">{r.sku}</div>{r.name && <div className="text-xs text-muted-foreground">{r.name}</div>}</td>
                    <td className="whitespace-nowrap p-2 text-right tabular-nums">{kgLabel(r.kg)}</td>
                    <td className="p-2 text-right tabular-nums">{r.shifts}</td>
                    <td className="border-l p-2 text-right font-semibold tabular-nums">{sec(r.medianSeconds)}</td>
                    <td className="p-2 text-right tabular-nums">{sec(r.bestSeconds)}</td>
                    <td className="p-2 text-right tabular-nums">{sec(r.worstSeconds)}</td>
                    <td className="p-2 text-right tabular-nums">{Math.round(r.unitsPerHour).toLocaleString("en-GB")}</td>
                    <td className="border-l p-2 text-right tabular-nums">{sec(r.itouchSeconds)}</td>
                    <td className={cn("p-2 text-right tabular-nums", r.flag === "far_from_itouch" && "font-semibold text-warning")}>{pct(r.vsItouch)}</td>
                    <td className="border-l p-2 text-right font-semibold tabular-nums" title={r.tmBasis ?? undefined}>{sec(r.tmSec)}</td>
                    <td className={cn("p-2 text-right tabular-nums", r.vsTm !== null && Math.abs(r.vsTm) > 0.5 && "font-semibold text-warning")}>{pct(r.vsTm)}</td>
                    <td className="border-l p-2">
                      <div className="flex flex-wrap gap-1">
                        {r.flag && <Badge variant="outline">{FLAG[r.flag]}</Badge>}
                        {r.tmSec === null && <Badge variant="outline">No Time &amp; Motion</Badge>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {missing.length > 0 && (
          <details className="rounded-lg border p-3 text-sm">
            <summary className="cursor-pointer font-medium">Products without a Time &amp; Motion value ({missing.length})</summary>
            <p className="mt-2 text-xs text-muted-foreground">Their pack size is not in the review for that line, or the product name carries no size.</p>
            <ul className="mt-2 grid gap-1 md:grid-cols-2">
              {missing.map((r) => (
                <li key={`${r.line}|${r.sku}`} className="tabular-nums">Line {r.line} · {r.sku} · {kgLabel(r.kg)}</li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
