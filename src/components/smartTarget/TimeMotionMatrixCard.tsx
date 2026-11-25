import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { TIME_MOTION, TIME_MOTION_SOURCE } from "@/lib/timeMotionMatrix";
import { packSizeKg } from "@/lib/packSize";
import { cn } from "@/lib/utils";

const LINES = Object.keys(TIME_MOTION).map(Number);
const kgLabel = (kg: number) => (kg < 1 ? `${Math.round(kg * 1000)} g` : `${kg} kg`);

/** Recommended fill speeds per line and pack size, as on the Time & Motion review sheet. Type a product or size to find its row. */
export function TimeMotionMatrixCard() {
  const [line, setLine] = useState<number | "all">("all");
  const [query, setQuery] = useState("");
  const kg = packSizeKg(query) ?? (Number(query.replace(",", ".")) > 0 ? Number(query.replace(",", ".")) : null);
  const lines = line === "all" ? LINES : [line];
  const max = useMemo(() => Math.max(...LINES.flatMap((l) => TIME_MOTION[l].map((r) => r[1]))), []);

  return (
    <Card data-testid="time-motion-matrix">
      <CardHeader className="space-y-4">
        <div>
          <CardTitle>Fill speed matrix</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Recommended speed per line and pack size, from the {TIME_MOTION_SOURCE}. Type a product name (e.g. "A.B.E 375G") or a size in kg to find it.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Product or pack size…" className="h-12 max-w-sm" autoComplete="off" />
          {(["all", ...LINES] as const).map((l) => (
            <button key={l} type="button" onClick={() => setLine(l)}
              className={cn("h-12 rounded-lg border px-4 text-sm font-medium", line === l ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted")}>
              {l === "all" ? "All lines" : `Line ${l}`}
            </button>
          ))}
        </div>
        {query && (
          <p className="text-sm">
            {kg === null ? <span className="text-muted-foreground">No pack size found in "{query}".</span>
              : <>Pack size <b>{kgLabel(kg)}</b>: {lines.map((l) => {
                  const r = TIME_MOTION[l].find((x) => Math.abs(x[0] - kg) < 0.0005);
                  return <Badge key={l} variant="outline" className={cn("ml-2", r ? "border-primary" : "opacity-60")}>Line {l}: {r ? `${r[2].toFixed(2)} s · ${Math.round(r[1])}/h` : "not on sheet"}</Badge>;
                })}</>}
          </p>
        )}
      </CardHeader>
      <CardContent>
        <div className={cn("grid gap-4", lines.length > 1 ? "md:grid-cols-2 xl:grid-cols-3" : "")}>
          {lines.map((l) => (
            <div key={l} className="overflow-hidden rounded-lg border">
              <div className="flex items-center justify-between bg-muted px-3 py-2">
                <span className="font-semibold">Line {l}</span>
                <span className="text-xs text-muted-foreground">{TIME_MOTION[l].length} sizes</span>
              </div>
              <div className="max-h-[420px] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card text-xs uppercase tracking-wide text-muted-foreground">
                    <tr><th className="p-2 text-left">Pack</th><th className="p-2 text-left">Tubs/h</th><th className="p-2 text-right">UPM</th><th className="p-2 text-right">Fill time</th></tr>
                  </thead>
                  <tbody>
                    {TIME_MOTION[l].map(([p, tph, s, basis]) => {
                      const hit = kg !== null && Math.abs(p - kg) < 0.0005;
                      return (
                        <tr key={p} title={basis || undefined} className={cn("border-t", hit && "bg-primary/15 font-semibold")}>
                          <td className="whitespace-nowrap p-2">{kgLabel(p)}</td>
                          <td className="p-2">
                            <div className="flex items-center gap-2">
                              <div className="h-2 flex-1 rounded bg-muted"><div className="h-2 rounded bg-primary" style={{ width: `${(tph / max) * 100}%` }} /></div>
                              <span className="w-12 text-right tabular-nums">{Math.round(tph)}</span>
                            </div>
                          </td>
                          <td className="p-2 text-right tabular-nums">{(tph / 60).toFixed(1)}</td>
                          <td className="p-2 text-right font-semibold tabular-nums">{s.toFixed(2)} s</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
